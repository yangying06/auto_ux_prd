export interface NormalizedAiProviderError {
  status: number
  message: string
  code?: string
  retryAfterSeconds?: number
  modelGroup?: string
}

interface ProviderErrorDetail {
  message?: string
  type?: string
  code?: string
  status?: number
  planType?: string
  resetsAt?: number
  resetsInSeconds?: number
  modelGroup?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  const serialized = safeJsonStringify(error)
  return serialized || fallback
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function parseEmbeddedJson(text: string): unknown | null {
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null

  for (let end = lastBrace; end > firstBrace; end = text.lastIndexOf('}', end - 1)) {
    try {
      return JSON.parse(text.slice(firstBrace, end + 1))
    } catch {
      // Try a shorter JSON-looking suffix.
    }
  }
  return null
}

function extractModelGroup(text: string) {
  return text.match(/(?:Received\s+)?Model Group=([^\s",}]+)/i)?.[1]
    ?? text.match(/\bmodel(?:_group)?["']?\s*[:=]\s*["']?([a-z0-9._:-]+)/i)?.[1]
}

function detailFromRecord(record: Record<string, unknown>, sourceText?: string): ProviderErrorDetail {
  const nestedError = asRecord(record.error)
  const source = nestedError ?? record
  const status = numberValue(source.status)
    ?? numberValue(source.status_code)
    ?? numberValue(record.status)
    ?? numberValue(record.statusCode)
  return {
    message: stringValue(source.message) ?? stringValue(record.message),
    type: stringValue(source.type) ?? stringValue(record.type),
    code: stringValue(source.code) ?? stringValue(record.code),
    status,
    planType: stringValue(source.plan_type) ?? stringValue(record.plan_type),
    resetsAt: numberValue(source.resets_at) ?? numberValue(record.resets_at),
    resetsInSeconds: numberValue(source.resets_in_seconds) ?? numberValue(record.resets_in_seconds),
    modelGroup: stringValue(source.model_group)
      ?? stringValue(record.model_group)
      ?? (sourceText ? extractModelGroup(sourceText) : undefined),
  }
}

function collectProviderDetails(value: unknown, details: ProviderErrorDetail[], seenMessages = new Set<string>()) {
  const record = asRecord(value)
  if (!record) return

  const serialized = safeJsonStringify(value)
  details.push(detailFromRecord(record, serialized ?? undefined))

  for (const key of ['message', 'error']) {
    const candidate = record[key]
    const candidateRecord = asRecord(candidate)
    if (candidateRecord) {
      collectProviderDetails(candidateRecord, details, seenMessages)
      continue
    }

    const text = stringValue(candidate)
    if (!text || seenMessages.has(text)) continue
    seenMessages.add(text)
    const embeddedJson = parseEmbeddedJson(text)
    if (embeddedJson) collectProviderDetails(embeddedJson, details, seenMessages)
    const modelGroup = extractModelGroup(text)
    if (modelGroup) details.push({ message: text, modelGroup })
  }
}

function statusFromUnknown(error: unknown, text: string) {
  const record = asRecord(error)
  const directStatus = record
    ? numberValue(record.status) ?? numberValue(record.statusCode) ?? numberValue(record.code)
    : undefined
  if (directStatus && directStatus >= 400 && directStatus < 600) return directStatus

  const textStatus = text.match(/\b(?:HTTP\s*)?([45]\d{2})\b/)?.[1]
  return textStatus ? Number.parseInt(textStatus, 10) : undefined
}

function formatRetryWait(seconds: number) {
  if (seconds <= 0) return '片刻'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `约 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `约 ${hours} 小时 ${restMinutes} 分钟` : `约 ${hours} 小时`
}

function firstDefined<T>(values: Array<T | undefined>) {
  return values.find((value): value is T => value !== undefined)
}

export function normalizeAiProviderError(error: unknown, fallback = '本地代理请求失败。'): NormalizedAiProviderError {
  const text = errorText(error, fallback)
  const details: ProviderErrorDetail[] = []
  const embeddedJson = parseEmbeddedJson(text)
  if (embeddedJson) collectProviderDetails(embeddedJson, details)
  collectProviderDetails(error, details)

  const searchable = [
    text,
    ...details.flatMap((detail) => [detail.message, detail.type, detail.code, detail.planType]),
  ].filter(Boolean).join('\n').toLowerCase()

  const status = firstDefined(details.map((detail) => detail.status))
    ?? statusFromUnknown(error, text)
    ?? (searchable.includes('429') || searchable.includes('rate_limit') || searchable.includes('throttling') ? 429 : 500)
  const modelGroup = firstDefined(details.map((detail) => detail.modelGroup)) ?? extractModelGroup(text)
  const retryAfterSeconds = firstDefined(details.map((detail) => detail.resetsInSeconds))
  const isUsageLimit = searchable.includes('usage_limit_reached') || searchable.includes('usage limit has been reached')
  const isRateLimit = status === 429
    || searchable.includes('ratelimit')
    || searchable.includes('rate_limit')
    || searchable.includes('throttling_error')
  const isAuthError = status === 401 || status === 403 || searchable.includes('invalid api key') || searchable.includes('unauthorized')

  if (isUsageLimit) {
    const waitText = retryAfterSeconds !== undefined ? `请等待${formatRetryWait(retryAfterSeconds)}后重试` : '请稍后重试'
    const modelText = modelGroup ? `（${modelGroup}）` : ''
    return {
      status: 429,
      code: 'usage_limit_reached',
      retryAfterSeconds,
      modelGroup,
      message: `AI 模型额度已用尽${modelText}。${waitText}，或在“环境配置”中切换 CLAUDE_MODEL / API Key。`,
    }
  }

  if (isRateLimit) {
    const modelText = modelGroup ? `（${modelGroup}）` : ''
    return {
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds,
      modelGroup,
      message: `AI 模型请求被限流${modelText}。请稍后重试，或在“环境配置”中切换模型 / API Key。`,
    }
  }

  if (isAuthError) {
    return {
      status,
      code: 'auth_error',
      modelGroup,
      message: 'AI 服务鉴权失败。请检查“环境配置”中的 API Key、Base URL 和模型名。',
    }
  }

  return {
    status,
    modelGroup,
    message: text || fallback,
  }
}
