/**
 * Lark (飞书) document import.
 *
 * Extracted from server/index.ts. Owns the entire lark-cli subprocess bridge:
 * running the CLI, parsing JSON envelopes, fetching doc content/markdown,
 * extracting and downloading embedded images, and assembling the import text.
 *
 * External dependencies are deliberately limited to the env config + the
 * shared image-media helpers so this module stays independently testable.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_ENV_CONFIG } from '../env'
import { mediaTypeFromValue, mediaTypeFromFilePath } from '../lib/imageMediaType'
import type { ImageMediaType } from '../../src/types/imageMedia'

/** Cache root for downloaded Lark media (images). */
const LARK_MEDIA_CACHE_ROOT = path.resolve(process.cwd(), '.cache', 'lark-media')
/** Max number of images pulled from a single Lark doc. */
const LARK_IMPORT_MAX_IMAGES = Math.min(6, Math.max(0, Number.parseInt(process.env.LARK_IMPORT_MAX_IMAGES ?? '4', 10)))
/** Max bytes per Lark image (downloads above this are skipped). */
const LARK_IMPORT_MAX_IMAGE_BYTES = Math.max(128 * 1024, Number.parseInt(process.env.LARK_IMPORT_MAX_IMAGE_BYTES ?? `${1200 * 1024}`, 10))
/** lark-cli subprocess timeout. */
const LARK_CLI_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.LARK_CLI_TIMEOUT_MS ?? '45000', 10))



function normalizeOptionalSourceText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export interface LarkCliRunResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface LarkImageReference {
  alt: string | null
  token: string | null
  url: string | null
}

export interface LarkImportedImage {
  name: string
  mediaType: ImageMediaType
  data: string
  sourceUrl: string | null
  token: string | null
  size: number
}

export class LarkImportError extends Error {
  status: number
  authorizationRequired: boolean
  hint: string | null

  constructor(message: string, options: { status?: number; authorizationRequired?: boolean; hint?: string | null } = {}) {
    super(message)
    this.name = 'LarkImportError'
    this.status = options.status ?? 400
    this.authorizationRequired = options.authorizationRequired ?? false
    this.hint = options.hint ?? null
  }
}

export function configuredLarkCliBin() {
  return (process.env.LARK_CLI_BIN ?? DEFAULT_ENV_CONFIG.LARK_CLI_BIN).trim() || DEFAULT_ENV_CONFIG.LARK_CLI_BIN
}

export function larkIdentityArgs() {
  const identity = (process.env.LARK_IDENTITY ?? DEFAULT_ENV_CONFIG.LARK_IDENTITY).trim().toLowerCase()
  return identity === 'user' || identity === 'bot' ? ['--as', identity] : []
}

export function larkChildEnv() {
  return {
    ...process.env,
    LARK_APP_ID: process.env.LARK_APP_ID ?? '',
    LARK_APP_SECRET: process.env.LARK_APP_SECRET ?? '',
    LARK_TENANT_ACCESS_TOKEN: process.env.LARK_TENANT_ACCESS_TOKEN ?? '',
    LARK_USER_ACCESS_TOKEN: process.env.LARK_USER_ACCESS_TOKEN ?? '',
  }
}

export function runLarkCli(args: string[], timeoutMs = LARK_CLI_TIMEOUT_MS): Promise<LarkCliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(configuredLarkCliBin(), args, {
      env: larkChildEnv(),
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new LarkImportError(`无法启动 lark-cli：${error.message}`, { status: 503 }))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new LarkImportError(`lark-cli 超过 ${Math.round(timeoutMs / 1000)} 秒未返回，请稍后重试或检查授权。`, { status: 504 }))
        return
      }
      resolve({ stdout, stderr, code })
    })
  })
}

export function tryParseJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function larkEnvelopeFromResult(result: LarkCliRunResult): Record<string, unknown> | null {
  const parsed = tryParseJson(result.stdout) ?? tryParseJson(result.stderr)
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
}

export function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function larkCliErrorMessage(envelope: Record<string, unknown> | null, result: LarkCliRunResult) {
  const error = nestedRecord(envelope?.error)
  const message = normalizeOptionalSourceText(error?.message)
    ?? normalizeOptionalSourceText(envelope?.message)
    ?? normalizeOptionalSourceText(result.stderr)
    ?? normalizeOptionalSourceText(result.stdout)
    ?? `lark-cli 退出码 ${result.code ?? 'unknown'}`
  const hint = normalizeOptionalSourceText(error?.hint)
  return { message, hint }
}

export function isLarkAuthorizationError(message: string, hint: string | null) {
  return /auth|login|permission|scope|unauthorized|forbidden|access token|授权|权限|登录|未授权|未登录|身份/iu.test(
    [message, hint].filter(Boolean).join('\n'),
  )
}

export async function runLarkCliJson(args: string[]) {
  const result = await runLarkCli([...args, '--json'])
  const envelope = larkEnvelopeFromResult(result)
  const ok = envelope?.ok
  if (result.code !== 0 || ok === false || !envelope) {
    const { message, hint } = larkCliErrorMessage(envelope, result)
    const authorizationRequired = isLarkAuthorizationError(message, hint)
    throw new LarkImportError(message, {
      status: authorizationRequired ? 409 : 400,
      authorizationRequired,
      hint,
    })
  }
  return envelope
}

export function normalizeLarkDocumentRef(value: unknown) {
  const text = normalizeOptionalSourceText(value)
  if (!text) throw new LarkImportError('请先粘贴飞书文档链接或文档 token。')
  if (/^https?:\/\/.+/iu.test(text)) return text
  if (/^[A-Za-z0-9_-]{8,}$/u.test(text)) return text
  throw new LarkImportError('飞书链接格式无效，请粘贴 docx/wiki 链接或文档 token。')
}

export function extractLarkDocumentContent(envelope: Record<string, unknown>) {
  const data = nestedRecord(envelope.data)
  const document = nestedRecord(data?.document)
  const content = normalizeOptionalSourceText(document?.content ?? data?.content ?? envelope.content)
  if (!content) throw new LarkImportError('飞书文档读取成功，但没有返回可分析正文。')
  return {
    content,
    title: normalizeOptionalSourceText(document?.title),
    documentId: normalizeOptionalSourceText(document?.document_id),
  }
}

export async function fetchLarkDocumentContent(documentRef: string, docFormat: 'markdown' | 'xml') {
  const envelope = await runLarkCliJson([
    'docs',
    '+fetch',
    '--api-version',
    'v2',
    '--doc',
    documentRef,
    '--doc-format',
    docFormat,
    '--detail',
    'simple',
    ...larkIdentityArgs(),
  ])
  return extractLarkDocumentContent(envelope)
}

export function parseXmlAttributes(value: string) {
  const attrs: Record<string, string> = {}
  const attrRegex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu
  for (const match of value.matchAll(attrRegex)) {
    const key = match[1]?.toLowerCase()
    if (key) attrs[key] = match[2] ?? match[3] ?? ''
  }
  return attrs
}

export function normalizeLarkImageTarget(rawTarget: string | null | undefined): Pick<LarkImageReference, 'token' | 'url'> | null {
  const target = rawTarget?.trim()
  if (!target || target.startsWith('data:')) return null
  if (/^https?:\/\//iu.test(target)) return { url: target, token: null }
  if (/^[A-Za-z0-9_-]{8,}$/u.test(target)) return { url: null, token: target }
  return null
}

export function dedupeLarkImageReferences(refs: LarkImageReference[]) {
  const seen = new Set<string>()
  const deduped: LarkImageReference[] = []
  for (const ref of refs) {
    const key = ref.url ?? ref.token
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(ref)
  }
  return deduped
}

export function extractLarkImageReferences(markdown: string, xml: string | null) {
  const refs: LarkImageReference[] = []
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu
  for (const match of markdown.matchAll(markdownImageRegex)) {
    const target = normalizeLarkImageTarget(match[2])
    if (target) refs.push({ alt: match[1]?.trim() || null, ...target })
  }

  if (xml) {
    const xmlImageRegex = /<img\b([^>]*)\/?>/giu
    for (const match of xml.matchAll(xmlImageRegex)) {
      const attrs = parseXmlAttributes(match[1])
      const target = normalizeLarkImageTarget(attrs.url) ?? normalizeLarkImageTarget(attrs.token)
      if (target) refs.push({ alt: attrs.alt || attrs.name || null, ...target })
    }
  }

  return dedupeLarkImageReferences(refs)
}


export function safePathSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'media'
}

export function findFirstFile(root: string): string | null {
  if (!existsSync(root)) return null
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isFile()) return fullPath
    if (entry.isDirectory()) {
      const nested = findFirstFile(fullPath)
      if (nested) return nested
    }
  }
  return null
}

export function imageFromBuffer(
  bytes: Buffer,
  mediaType: ImageMediaType,
  ref: LarkImageReference,
  index: number,
): LarkImportedImage | null {
  if (bytes.byteLength > LARK_IMPORT_MAX_IMAGE_BYTES) return null
  return {
    name: ref.alt || `feishu-image-${index + 1}`,
    mediaType,
    data: bytes.toString('base64'),
    sourceUrl: ref.url,
    token: ref.token,
    size: bytes.byteLength,
  }
}

export async function downloadLarkImageFromUrl(ref: LarkImageReference, index: number) {
  if (!ref.url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(ref.url, { signal: controller.signal })
    if (!response.ok) return null
    const mediaType = mediaTypeFromValue(response.headers.get('content-type'))
    if (!mediaType) return null
    const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
    if (contentLength > LARK_IMPORT_MAX_IMAGE_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return imageFromBuffer(bytes, mediaType, ref, index)
  } finally {
    clearTimeout(timer)
  }
}

export async function downloadLarkImageFromToken(ref: LarkImageReference, index: number) {
  if (!ref.token) return null
  const outputDir = path.join(LARK_MEDIA_CACHE_ROOT, safePathSegment(ref.token))
  mkdirSync(outputDir, { recursive: true })
  await runLarkCliJson([
    'docs',
    '+media-preview',
    '--token',
    ref.token,
    '--output',
    path.join(outputDir, 'image'),
    '--overwrite',
    ...larkIdentityArgs(),
  ])
  const filePath = findFirstFile(outputDir)
  if (!filePath) return null
  const mediaType = mediaTypeFromFilePath(filePath)
  if (!mediaType) return null
  const stats = statSync(filePath)
  if (stats.size > LARK_IMPORT_MAX_IMAGE_BYTES) return null
  return imageFromBuffer(readFileSync(filePath), mediaType, ref, index)
}

export async function importLarkImages(refs: LarkImageReference[]) {
  const images: LarkImportedImage[] = []
  const warnings: string[] = []
  const cappedRefs = refs.slice(0, LARK_IMPORT_MAX_IMAGES)

  for (const [index, ref] of cappedRefs.entries()) {
    try {
      const image = ref.url
        ? await downloadLarkImageFromUrl(ref, index)
        : await downloadLarkImageFromToken(ref, index)
      if (image) images.push(image)
      else warnings.push(`飞书图片 ${index + 1} 未能下载为可分析图片，已保留文本中的图片引用。`)
    } catch (error) {
      warnings.push(`飞书图片 ${index + 1} 读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (refs.length > cappedRefs.length) {
    warnings.push(`飞书文档包含 ${refs.length} 张图片，本次最多随 AI 请求读取 ${LARK_IMPORT_MAX_IMAGES} 张。`)
  }

  return { images, warnings }
}

export function titleFromMarkdown(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/mu)?.[1]
  return heading?.trim() || null
}

export function buildLarkImportText(options: {
  documentRef: string
  title: string
  markdown: string
  imageRefs: LarkImageReference[]
  importedImages: LarkImportedImage[]
}) {
  const imageIndex = options.imageRefs.length
    ? options.imageRefs.map((ref, index) => {
        const imported = options.importedImages.find((image) => image.sourceUrl === ref.url || image.token === ref.token)
        return [
          `- 图片 ${index + 1}：${ref.alt || imported?.name || '未命名图片'}`,
          ref.url ? `  - URL：${ref.url}` : null,
          ref.token ? `  - token：${ref.token}` : null,
          imported ? `  - 已作为视觉证据传入：${imported.mediaType}，${imported.size} bytes` : '  - 未下载为视觉证据，请根据正文引用继续判断',
        ].filter(Boolean).join('\n')
      }).join('\n')
    : '- 未检测到图片引用。'

  return [
    `# 飞书文档：${options.title}`,
    '',
    `- 来源：${options.documentRef}`,
    `- 图片引用数：${options.imageRefs.length}`,
    `- 已随 AI 请求传入图片数：${options.importedImages.length}`,
    '',
    '## 正文',
    '',
    options.markdown.trim(),
    '',
    '## 图片索引',
    '',
    imageIndex,
  ].join('\n')
}
