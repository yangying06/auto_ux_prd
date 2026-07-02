interface FigmaFlowFrameEvidence {
  id?: string | null
  name?: string | null
  visibleTexts?: string[] | null
  annotations?: string[] | null
  interactionTips?: string[] | null
}

interface FigmaFlowGroupEvidence {
  label: string
  frames: FigmaFlowFrameEvidence[]
}

export interface FigmaRelationSemanticsInput {
  connectorName: string
  connectorId: string
  connectorBounds?: string | null
  sourceGroup: FigmaFlowGroupEvidence
  targetGroup: FigmaFlowGroupEvidence
  sourceFrame?: FigmaFlowFrameEvidence | null
  targetFrame?: FigmaFlowFrameEvidence | null
  direction: string
  sourcePoint: string
  targetPoint: string
  fallbackLabel?: string | null
  fallbackReason?: string | null
}

function compactText(value: string | null | undefined, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function uniqueTexts(values: Array<string | null | undefined>, maxItems = 8) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = compactText(value)
    const key = text.toLocaleLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function stripInteractionTipPrefix(text: string) {
  return compactText(text)
    .replace(/^(Interaction\s*tips?|Tips?)\s*[:：-]?\s*/iu, '')
    .replace(/^交互提示\s*[:：-]?\s*/u, '')
    .replace(/^提示\s*[:：-]?\s*/u, '')
    .replace(/[~～]+$/u, '')
    .trim()
}

function localizeCommonEnglishTip(text: string) {
  let next = text
    .replace(/\blong\s*press\b/igu, '长按')
    .replace(/\bpress\s+and\s+hold\b/igu, '长按')
    .replace(/\btap\b|\bclick\b/igu, '点击')
    .replace(/\bpress\b/igu, '按压')
    .replace(/\bthe\s+gift\b|\bgift\b/igu, '礼物')
    .replace(/\bto\s+preview\s+it\b/igu, '可预览')
    .replace(/\bpreview\s+it\b/igu, '预览')
    .replace(/\bpreview\b/igu, '预览')
    .replace(/\bopen\b|\bshow\b/igu, '打开')
    .replace(/\bnavigate\s+to\b|\bjump\s+to\b|\bgo\s+to\b/igu, '进入')
    .replace(/\bconfirm\b/igu, '确认')
    .replace(/\bcancel\b/igu, '取消')
    .replace(/\bclose\b/igu, '关闭')
  next = next
    .replace(/\s+/g, '')
    .replace(/长按礼物可预览/u, '长按礼物可预览')
    .replace(/点击礼物可预览/u, '点击礼物可预览')
  return next
}

export function normalizeFigmaInteractionTipText(text: string | null | undefined) {
  const stripped = stripInteractionTipPrefix(String(text ?? ''))
  if (!stripped) return ''
  const localized = /[a-z]/iu.test(stripped) ? localizeCommonEnglishTip(stripped) : stripped
  return compactText(localized, 80)
}

export function formatFigmaInteractionTipRequirement(text: string | null | undefined) {
  const normalized = normalizeFigmaInteractionTipText(text)
  return normalized ? `交互提示：${normalized}` : ''
}

function frameTips(frame: FigmaFlowFrameEvidence | null | undefined) {
  if (!frame) return []
  const explicitTips = frame.interactionTips ?? []
  const annotationTips = (frame.annotations ?? []).filter((text) => /^(Interaction\s*tips?|Tips?|交互提示|提示)\s*[:：-]?/iu.test(text))
  return uniqueTexts([...explicitTips, ...annotationTips]
    .map((text) => formatFigmaInteractionTipRequirement(text)), 6)
}

function groupTips(group: FigmaFlowGroupEvidence) {
  return uniqueTexts(group.frames.flatMap((frame) => frameTips(frame)), 10)
}

function conciseTip(text: string | null | undefined) {
  const normalized = normalizeFigmaInteractionTipText(text)
  if (!normalized) return ''
  return normalized.length > 14 ? `${normalized.slice(0, 14)}…` : normalized
}

function firstActionText(values: Array<string | null | undefined>) {
  return uniqueTexts(values, 12)
    .find((text) => /点击|长按|按压|打开|进入|跳转|预览|确认|取消|关闭|提交|选择|返回|tap|click|press|preview|open|show|confirm|cancel|close/iu.test(text))
    ?? ''
}

export function deriveFigmaRelationIntent(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame' | 'fallbackLabel'>) {
  const sourceTip = frameTips(input.sourceFrame)[0] ?? groupTips(input.sourceGroup)[0]
  const targetTip = frameTips(input.targetFrame)[0] ?? groupTips(input.targetGroup)[0]
  const tipIntent = conciseTip(sourceTip || targetTip)
  if (tipIntent) return tipIntent

  const sourceAction = firstActionText([
    input.sourceFrame?.name,
    ...(input.sourceFrame?.annotations ?? []),
    ...(input.sourceFrame?.visibleTexts ?? []),
  ])
  if (sourceAction) return compactText(sourceAction, 18)

  const fallback = compactText(input.fallbackLabel, 18)
  if (fallback && !/^Figma\s*(箭头连接|连接线)/iu.test(fallback)) return fallback
  return `进入${input.targetGroup.label}`
}

export function formatFigmaRelationLabel(input: FigmaRelationSemanticsInput) {
  return deriveFigmaRelationIntent(input)
}

function frameSummary(label: string, frame: FigmaFlowFrameEvidence | null | undefined) {
  if (!frame) return null
  const texts = uniqueTexts(frame.visibleTexts ?? [], 4).join(' / ')
  const tips = frameTips(frame).join(' / ')
  return [
    `${label}Frame：${frame.name ?? frame.id ?? '未命名'}`,
    frame.id ? `node-id=${frame.id}` : null,
    texts ? `文案=${texts}` : null,
    tips ? `提示=${tips}` : null,
  ].filter(Boolean).join('；')
}

export function formatFigmaRelationReason(input: FigmaRelationSemanticsInput) {
  const intent = deriveFigmaRelationIntent(input)
  const sourceTips = groupTips(input.sourceGroup).join(' / ')
  const targetTips = groupTips(input.targetGroup).join(' / ')
  return [
    `Figma 连接线「${input.connectorName}」(${input.connectorId})：${input.sourceGroup.label} → ${input.targetGroup.label}`,
    `交互意图：${intent}`,
    `方向依据：${input.direction}；源端点 ${input.sourcePoint}；目标端点 ${input.targetPoint}`,
    input.connectorBounds ? `范围：${input.connectorBounds}` : null,
    frameSummary('源', input.sourceFrame),
    frameSummary('目标', input.targetFrame),
    sourceTips ? `源界面 tips：${sourceTips}` : null,
    targetTips ? `目标界面 tips：${targetTips}` : null,
    input.fallbackReason,
  ].filter(Boolean).join('。\n')
}

export function formatFigmaInteractionTipsMarkdown(frames: FigmaFlowFrameEvidence[]) {
  const tips = uniqueTexts(frames.flatMap((frame) => frameTips(frame)), 12)
  return tips.length
    ? tips.map((tip) => `- ${tip}`).join('\n')
    : '- 未识别到 Figma interaction tips。'
}
