import type {
  FigmaUxMap,
  FigmaUxMapAmbiguity,
  FigmaUxMapAmbiguityKind,
  FigmaUxMapReviewSource,
  FigmaUxMapScreen,
  FigmaUxMapState,
  FigmaUxMapStateRole,
  FigmaUxMapTransition,
  FigmaUxMapTransitionSource,
  PrdStateTransition,
  PrdUiState,
  PrdUiStateKind,
} from '../src/types/prdNode'

export interface FigmaAnnotationCandidate {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  kind?: 'annotation' | 'interaction_tip'
  path?: string
}

export interface FigmaSemanticFrame {
  id: string
  name: string
  sourceUrl: string
  assetUrl?: string | null
  x: number
  y: number
  width: number
  height: number
  visibleTexts: string[]
  annotations?: string[]
}

export interface FigmaUiStateClassification {
  kind: PrdUiStateKind
  label: string
  confidence: number
}

export interface FigmaStateTransitionCue {
  trigger: string
  targetHint: string | null
  condition: string | null
  effect: string | null
  evidence: string
  confidence: number
}

export interface FigmaSemanticGroup {
  key: string
  label: string
  frames: FigmaSemanticFrame[]
}

export interface FigmaSemanticRelation {
  sourceGroupKey: string
  targetGroupKey: string
  label: string
  reason: string
  confidence: number
  source: FigmaUxMapTransitionSource
}

export interface FigmaEndpointMetaCandidate {
  index: number
  meta?: number
}

export interface FigmaLineMergeCandidate {
  targetGroupKey: string
  distance: number
}

export interface BuildFigmaUxMapInput {
  sourceUrl: string
  rootName: string
  groups: FigmaSemanticGroup[]
  relations: FigmaSemanticRelation[]
}

const KIND_LABELS: Record<PrdUiStateKind, string> = {
  default: '默认态',
  overlay: '浮层/弹窗态',
  loading: '加载态',
  success: '成功态',
  error: '失败/错误态',
  empty: '空态',
  disabled: '禁用态',
  expanded: '展开态',
  collapsed: '收起态',
  localized: '多语言态',
  mirror: '镜像态',
  selected: '选中态',
  variant: '变体态',
}

const STATE_RULES: Array<{ kind: PrdUiStateKind; pattern: RegExp; label: string; confidence: number }> = [
  { kind: 'overlay', pattern: /半屏|浮层|弹窗|弹层|面板|底部弹|bottom\s*sheet|modal|popup|popover/i, label: '浮层/弹窗态', confidence: 92 },
  { kind: 'loading', pattern: /加载|loading|生成中|处理中|等待|进度中|转圈/i, label: '加载态', confidence: 90 },
  { kind: 'success', pattern: /成功|完成|领取成功|提交成功|success|complete/i, label: '成功态', confidence: 90 },
  { kind: 'error', pattern: /失败|错误|异常|失败态|error|fail|failed|超时/i, label: '失败/错误态', confidence: 90 },
  { kind: 'empty', pattern: /空状态|空态|暂无|无数据|empty/i, label: '空态', confidence: 88 },
  { kind: 'disabled', pattern: /禁用|置灰|不可点|不可用|disabled/i, label: '禁用态', confidence: 88 },
  { kind: 'expanded', pattern: /展开|expanded|open/i, label: '展开态', confidence: 84 },
  { kind: 'collapsed', pattern: /收起|折叠|collapsed|close/i, label: '收起态', confidence: 84 },
  { kind: 'mirror', pattern: /镜像|mirror|rtl/i, label: '镜像态', confidence: 88 },
  { kind: 'localized', pattern: /中文|英文|英语|阿语|日语|韩语|繁中|简中|多语言|language|locale|local/i, label: '多语言态', confidence: 86 },
  { kind: 'selected', pattern: /选中|未选中|高亮|checked|selected|active/i, label: '选中态', confidence: 82 },
  { kind: 'default', pattern: /默认|初始|default|initial/i, label: '默认态', confidence: 80 },
]

function compact(value: string | null | undefined, maxLength = 180) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

export function isStrictFigmaInterfaceFrameSize(width: number, height: number) {
  return Math.abs(width - 750) <= 10 && height > 1500
}

export function chooseFigmaMetaTargetEndpointIndex(points: FigmaEndpointMetaCandidate[]) {
  const metas = points
    .map((point) => point.meta)
    .filter((meta): meta is number => typeof meta === 'number')
  if (metas.length < 2) return null
  const min = Math.min(...metas)
  const max = Math.max(...metas)
  if (max - min < 1) return null

  const targets = points.filter((point) => point.meta === min)
  return targets.length === 1 ? targets[0].index : null
}

export function chooseStableFigmaLineMergeCandidate(
  candidates: FigmaLineMergeCandidate[],
  maxDistance: number,
  conflictDistanceDelta = 12,
) {
  const viable = candidates
    .filter((candidate) => Number.isFinite(candidate.distance) && candidate.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.targetGroupKey.localeCompare(b.targetGroupKey))
  const best = viable[0]
  if (!best) return null

  const conflicting = viable.find((candidate) => {
    return candidate.targetGroupKey !== best.targetGroupKey
      && candidate.distance - best.distance <= conflictDistanceDelta
  })
  return conflicting ? null : best
}

function stripFigmaScreenVariantTerms(value: string) {
  return value
    .replace(/\s*(?:_|-|—|–)?\s*(?:默认|初始|输入前|输入后|有文字输入|无文字输入|短屏|长屏|裁切上方|裁切下方|空状态|空态|加载中|loading|成功|失败|生成成功|生成失败|审核失败|进程中|处理中|选中|未选中|禁用|置灰|展开|收起|单按钮|双按钮|管理中|管理自建礼物中|预览态|编辑态)\s*$/iu, '')
    .replace(/[（(](?:默认|初始|短屏|长屏|镜像|成功|失败|生成成功|生成失败|空状态|加载中|单按钮|双按钮)[）)]$/iu, '')
    .trim()
}

export function normalizeFigmaScreenFamilyLabel(name: string) {
  const raw = compact(name, 80)
    .replace(/页面/g, '界面')
    .replace(/\s+/g, '')
    .replace(/^[_\s-]+/u, '')
    .trim()
  if (!raw) return ''

  const withoutVariant = stripFigmaScreenVariantTerms(raw)
  const createdMatch = withoutVariant.match(/^(?:没|没有|未)创建过(.+)$/u)
    ?? withoutVariant.match(/^有创建过(.+)$/u)
  if (createdMatch?.[1]) return `是否创建过${createdMatch[1].replace(/界面$/u, '')}界面`

  const stepMatch = withoutVariant.match(/^(.{0,20}?生成步骤)\s*\d+$/u)
  if (stepMatch?.[1]) return `${stepMatch[1].replace(/界面$/u, '')}界面`

  const rawResultMatch = raw.match(/^(.+?)(?:成功|失败|异常|错误)$/u)
  if (rawResultMatch?.[1] && rawResultMatch[1].length >= 2) return `${rawResultMatch[1].replace(/界面$/u, '')}界面`

  const resultMatch = withoutVariant.match(/^(.+?)(?:成功|失败|异常|错误)$/u)
  if (resultMatch?.[1] && resultMatch[1].length >= 2) return `${resultMatch[1].replace(/界面$/u, '')}界面`

  return withoutVariant || raw
}

function uniqueTexts(values: Array<string | null | undefined>, maxItems: number) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = compact(value)
    const key = text.replace(/\s+/g, ' ').toLocaleLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function annotationBodyText(value: string) {
  return value.replace(/^(?:AI总结|交互提示|注释|说明|备注|标注)\s*[:：]\s*/u, '').trim()
}

function isChineseAnnotationText(value: string) {
  return /[\u3400-\u9fff]/u.test(annotationBodyText(value))
}

function uniqueChineseAnnotations(values: Array<string | null | undefined>, maxItems: number) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = compact(value)
    const key = text.replace(/\s+/g, ' ').toLocaleLowerCase()
    if (!text || !isChineseAnnotationText(text) || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function cleanupStateLabel(name: string, groupLabel?: string | null) {
  let label = compact(name, 64)
  const group = compact(groupLabel, 64)
  if (group && label !== group) {
    label = label
      .replace(new RegExp(`^${escapeRegExp(group)}[\\s_\\-/：:（）()]*`, 'iu'), '')
      .replace(new RegExp(`[\\s_\\-/：:（）()]*${escapeRegExp(group)}$`, 'iu'), '')
      .trim()
  }

  const explicit = label.match(/(半屏浮层|浮层|弹窗|弹层|面板|加载中|生成中|处理中|成功|失败|错误|空状态|空态|展开|收起|折叠|镜像|中文|英文|阿语|多语言|默认|初始|选中|未选中|禁用|置灰)/iu)?.[1]
  return compact(explicit ?? label, 40)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function figmaUiStateKindLabel(kind: PrdUiStateKind) {
  return KIND_LABELS[kind] ?? KIND_LABELS.variant
}

export function classifyFigmaUiState(
  name: string,
  groupLabel?: string | null,
  extraTexts: string[] = [],
): FigmaUiStateClassification {
  const haystack = [name, groupLabel, ...extraTexts].filter(Boolean).join(' ')
  const hit = STATE_RULES.find((rule) => rule.pattern.test(haystack))
  if (!hit) {
    return {
      kind: 'variant',
      label: cleanupStateLabel(name, groupLabel) || '变体态',
      confidence: 66,
    }
  }

  return {
    kind: hit.kind,
    label: cleanupStateLabel(name, groupLabel) || hit.label,
    confidence: hit.confidence,
  }
}

function overlapLength(aStart: number, aLength: number, bStart: number, bLength: number) {
  return Math.max(0, Math.min(aStart + aLength, bStart + bLength) - Math.max(aStart, bStart))
}

function centerInside(candidate: FigmaAnnotationCandidate, frame: FigmaSemanticFrame) {
  const cx = candidate.x + candidate.width / 2
  const cy = candidate.y + candidate.height / 2
  return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height
}

function annotationKeywordHit(text: string) {
  return /注释|说明|备注|标注|状态|触发|点击|长按|双击|进入|打开|弹出|关闭|返回|跳转|入口|流程|交互|条件|规则|展示|浮层|弹窗|toast|hover|tap|click|press/i.test(text)
}

export function collectNearbyFigmaAnnotations(
  frame: FigmaSemanticFrame,
  candidates: FigmaAnnotationCandidate[],
  maxItems = 6,
) {
  const visibleTextKeys = new Set(frame.visibleTexts.map((text) => compact(text).toLocaleLowerCase()))
  const scored = candidates
    .map((candidate) => {
      const text = compact(candidate.text, 180)
      if (!text || visibleTextKeys.has(text.toLocaleLowerCase()) || centerInside(candidate, frame)) return null

      const horizontalOverlap = overlapLength(candidate.x, candidate.width, frame.x, frame.width)
      const verticalOverlap = overlapLength(candidate.y, candidate.height, frame.y, frame.height)
      const horizontalRatio = horizontalOverlap / Math.max(1, Math.min(candidate.width, frame.width))
      const verticalRatio = verticalOverlap / Math.max(1, Math.min(candidate.height, frame.height))
      const aboveDistance = frame.y - (candidate.y + candidate.height)
      const belowDistance = candidate.y - (frame.y + frame.height)
      const leftDistance = frame.x - (candidate.x + candidate.width)
      const rightDistance = candidate.x - (frame.x + frame.width)

      const above = aboveDistance >= -24 && aboveDistance <= 180 && horizontalRatio >= 0.2
      const below = belowDistance >= -12 && belowDistance <= 120 && horizontalRatio >= 0.25
      const left = leftDistance >= -24 && leftDistance <= 260 && verticalRatio >= 0.12
      const right = rightDistance >= -24 && rightDistance <= 260 && verticalRatio >= 0.12
      const keyword = annotationKeywordHit(text)
      const centerDistance = Math.hypot(
        candidate.x + candidate.width / 2 - (frame.x + frame.width / 2),
        candidate.y + candidate.height / 2 - (frame.y + frame.height / 2),
      )
      if (!above && !below && !left && !right) {
        if (!keyword || centerDistance > Math.max(640, frame.width * 1.4)) return null
      }

      const distance = Math.min(
        above ? Math.max(0, aboveDistance) : Number.POSITIVE_INFINITY,
        below ? Math.max(0, belowDistance) : Number.POSITIVE_INFINITY,
        left ? Math.max(0, leftDistance) : Number.POSITIVE_INFINITY,
        right ? Math.max(0, rightDistance) : Number.POSITIVE_INFINITY,
        keyword ? 320 : Number.POSITIVE_INFINITY,
      )
      return { text, score: (keyword ? 0 : 80) + distance }
    })
    .filter((item): item is { text: string; score: number } => Boolean(item))
    .sort((a, b) => a.score - b.score)

  return uniqueTexts(scored.map((item) => item.text), maxItems)
}

export function collectNearbyFigmaInteractionTips(
  frame: FigmaSemanticFrame,
  candidates: FigmaAnnotationCandidate[],
  maxItems = 8,
) {
  // Figma 交互 tips 通常作为 callout 画在界面 frame 外部（上方/右侧），
  // 不能仅用「中心点落在 frame 内」判定，否则几乎采集不到。
  // 这里复用 nearby 几何判定，对 interaction_tip 候选放宽距离阈值。
  const visibleTextKeys = new Set(frame.visibleTexts.map((text) => compact(text).toLocaleLowerCase()))
  const scored = candidates
    .filter((candidate) => candidate.kind === 'interaction_tip')
    .map((candidate) => {
      const text = compact(candidate.text, 180)
      if (!text || visibleTextKeys.has(text.toLocaleLowerCase())) return null

      const horizontalOverlap = overlapLength(candidate.x, candidate.width, frame.x, frame.width)
      const verticalOverlap = overlapLength(candidate.y, candidate.height, frame.y, frame.height)
      const horizontalRatio = horizontalOverlap / Math.max(1, Math.min(candidate.width, frame.width))
      const verticalRatio = verticalOverlap / Math.max(1, Math.min(candidate.height, frame.height))
      const aboveDistance = frame.y - (candidate.y + candidate.height)
      const belowDistance = candidate.y - (frame.y + frame.height)
      const leftDistance = frame.x - (candidate.x + candidate.width)
      const rightDistance = candidate.x - (frame.x + frame.width)

      const inside = horizontalOverlap > 0 && verticalOverlap > 0
      const above = aboveDistance >= -24 && aboveDistance <= 320 && horizontalRatio >= 0.1
      const below = belowDistance >= -12 && belowDistance <= 240 && horizontalRatio >= 0.1
      const left = leftDistance >= -24 && leftDistance <= 420 && verticalRatio >= 0.08
      const right = rightDistance >= -24 && rightDistance <= 420 && verticalRatio >= 0.08
      if (!inside && !above && !below && !left && !right) return null

      const distance = Math.min(
        inside ? 0 : Number.POSITIVE_INFINITY,
        above ? Math.max(0, aboveDistance) : Number.POSITIVE_INFINITY,
        below ? Math.max(0, belowDistance) : Number.POSITIVE_INFINITY,
        left ? Math.max(0, leftDistance) : Number.POSITIVE_INFINITY,
        right ? Math.max(0, rightDistance) : Number.POSITIVE_INFINITY,
      )
      return { text, score: distance }
    })
    .filter((item): item is { text: string; score: number } => Boolean(item))
    .sort((a, b) => a.score - b.score)

  return uniqueTexts(scored.map((item) => item.text), maxItems)
}

function cleanTargetHint(value: string | null | undefined) {
  const text = compact(value, 48)
    .replace(/[，。；;、].*$/u, '')
    .replace(/[_\-—/]+.*$/u, '')
    .replace(/^(到|至|为|成)/u, '')
    .replace(/(界面|页面|状态|浮层|弹窗|面板)$/u, '')
    .trim()
  return text || null
}

export function extractFigmaStateTransitionCue(text: string): FigmaStateTransitionCue | null {
  const source = compact(text, 180)
  if (!source) return null

  const direct = source.match(/(长按|点击|单击|双击|选择|拖动|滑动|hover|tap|click|press)\s*([^，。；;、_—\-/:：]{0,28}?)(打开|进入|弹出|跳转到|跳转至|跳至|展示|显示|唤起|关闭|返回|收起|展开)\s*([^，。；;、]{0,56})/iu)
  if (direct) {
    const action = compact([direct[1], direct[2]].join(''), 40)
    const effect = compact([direct[3], direct[4]].join(''), 72)
    return {
      trigger: action || direct[1],
      targetHint: cleanTargetHint(direct[4]),
      condition: null,
      effect,
      evidence: source,
      confidence: 86,
    }
  }

  const fromTo = source.match(/从\s*([^，。；;、]{1,32}?)(?:点击|进入|打开|跳转到|跳转至|跳至)\s*([^，。；;、]{1,56})/iu)
  if (fromTo) {
    return {
      trigger: `从${compact(fromTo[1], 32)}进入`,
      targetHint: cleanTargetHint(fromTo[2]),
      condition: compact(fromTo[1], 48),
      effect: `进入${compact(fromTo[2], 56)}`,
      evidence: source,
      confidence: 82,
    }
  }

  const stateOnly = source.match(/(打开|弹出|展示|显示|关闭|收起|展开)\s*([^，。；;、]{1,56})/iu)
  if (stateOnly && /(触发|状态|交互|入口|点击|长按|按钮|浮层|弹窗)/iu.test(source)) {
    return {
      trigger: compact(source.replace(stateOnly[0], ''), 48) || stateOnly[1],
      targetHint: cleanTargetHint(stateOnly[2]),
      condition: null,
      effect: compact(stateOnly[0], 72),
      evidence: source,
      confidence: 72,
    }
  }

  return null
}

export function buildFigmaUiStatesForFrames(
  nodeId: string,
  groupLabel: string,
  frames: FigmaSemanticFrame[],
): PrdUiState[] {
  return frames.map((frame, index) => {
    const classification = classifyFigmaUiState(frame.name, groupLabel, [
      ...frame.visibleTexts,
      ...(frame.annotations ?? []),
    ])
    return {
      id: `${nodeId}-state-${String(index + 1).padStart(2, '0')}-${frame.id.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
      label: classification.label,
      kind: classification.kind,
      figmaNodeId: frame.id,
      sourceUrl: frame.sourceUrl,
      previewImageUrl: frame.assetUrl ?? null,
      visibleTexts: uniqueTexts(frame.visibleTexts, 12),
      annotations: uniqueChineseAnnotations(frame.annotations ?? [], 8),
      confidence: classification.confidence,
    }
  })
}

export function createFigmaStateTransition(params: {
  id: string
  sourceNodeId: string
  sourceStateId?: string | null
  targetNodeId: string
  targetStateId?: string | null
  trigger?: string | null
  condition?: string | null
  effect?: string | null
  evidence: string[]
  confidence: number
  source?: PrdStateTransition['source']
}): PrdStateTransition {
  return {
    id: params.id,
    sourceNodeId: params.sourceNodeId,
    sourceStateId: params.sourceStateId ?? null,
    targetNodeId: params.targetNodeId,
    targetStateId: params.targetStateId ?? null,
    trigger: params.trigger ?? null,
    condition: params.condition ?? null,
    effect: params.effect ?? null,
    evidence: uniqueTexts(params.evidence, 8),
    confidence: Math.max(0, Math.min(100, Math.round(params.confidence))),
    source: params.source ?? null,
  }
}

export function uniqueFigmaStateTransitions(transitions: PrdStateTransition[]) {
  const seen = new Set<string>()
  return transitions.filter((transition) => {
    const key = [
      transition.sourceNodeId,
      transition.sourceStateId ?? '',
      transition.targetNodeId,
      transition.targetStateId ?? '',
      transition.trigger ?? '',
      transition.effect ?? '',
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const UX_STATE_ROLES = new Set<FigmaUxMapStateRole>(['base', 'variant', 'overlay', 'feedback', 'localized'])
const UX_TRANSITION_SOURCES = new Set<FigmaUxMapTransitionSource>([
  'figma_connector',
  'figma_prototype',
  'frame_title',
  'annotation',
  'prd_text',
  'canvas_order',
  'text_entry',
  'ai_review',
])
const UX_AMBIGUITY_KINDS = new Set<FigmaUxMapAmbiguityKind>([
  'screen_grouping',
  'state_role',
  'transition_target',
  'missing_trigger',
  'prd_conflict',
  'low_confidence',
])
const UX_REVIEW_SOURCES = new Set<FigmaUxMapReviewSource>(['heuristic', 'ai_review', 'ai_review_fallback'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function numberPercent(value: unknown, fallback = 70) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed))
  }
  return fallback
}

function textList(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return []
  return uniqueTexts(value.map((item) => typeof item === 'string' ? item : null), limit)
}

function idSafe(value: string | null | undefined, fallback: string) {
  const safe = compact(value, 64)
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40)
  return safe || fallback
}

function uxStateRoleForKind(kind: PrdUiStateKind): FigmaUxMapStateRole {
  if (kind === 'default') return 'base'
  if (kind === 'overlay') return 'overlay'
  if (kind === 'localized' || kind === 'mirror') return 'localized'
  if (kind === 'loading' || kind === 'success' || kind === 'error' || kind === 'empty' || kind === 'disabled') return 'feedback'
  return 'variant'
}

function normalizeUxStateRole(value: unknown, fallback: FigmaUxMapStateRole) {
  return typeof value === 'string' && UX_STATE_ROLES.has(value as FigmaUxMapStateRole)
    ? value as FigmaUxMapStateRole
    : fallback
}

function normalizeUxTransitionSource(value: unknown, fallback: FigmaUxMapTransitionSource) {
  return typeof value === 'string' && UX_TRANSITION_SOURCES.has(value as FigmaUxMapTransitionSource)
    ? value as FigmaUxMapTransitionSource
    : fallback
}

function normalizeUxAmbiguityKind(value: unknown, fallback: FigmaUxMapAmbiguityKind) {
  return typeof value === 'string' && UX_AMBIGUITY_KINDS.has(value as FigmaUxMapAmbiguityKind)
    ? value as FigmaUxMapAmbiguityKind
    : fallback
}

function normalizeUxReviewSource(value: unknown, fallback: FigmaUxMapReviewSource) {
  return typeof value === 'string' && UX_REVIEW_SOURCES.has(value as FigmaUxMapReviewSource)
    ? value as FigmaUxMapReviewSource
    : fallback
}

function screenId(index: number, group: FigmaSemanticGroup) {
  return `UX-SCREEN-${String(index + 1).padStart(2, '0')}-${idSafe(group.label, group.key)}`
}

function stateId(screen: FigmaUxMapScreen, index: number, frame: FigmaSemanticFrame) {
  return `${screen.id}-STATE-${String(index + 1).padStart(2, '0')}-${idSafe(frame.name, frame.id)}`
}

function transitionId(index: number, sourceScreenId: string, targetScreenId: string, source: FigmaUxMapTransitionSource) {
  return `UX-TRANSITION-${String(index + 1).padStart(2, '0')}-${idSafe(sourceScreenId, 'source')}-${idSafe(targetScreenId, 'target')}-${source}`
}

function ambiguityId(index: number, kind: FigmaUxMapAmbiguityKind) {
  return `UX-AMBIGUITY-${String(index + 1).padStart(2, '0')}-${kind}`
}

function primaryFrameForGroup(group: FigmaSemanticGroup) {
  return [...group.frames].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] ?? null
}

function frameCue(frame: FigmaSemanticFrame) {
  return [frame.name, ...(frame.annotations ?? [])]
    .map((text) => ({ text, cue: extractFigmaStateTransitionCue(text) }))
    .find((item): item is { text: string; cue: NonNullable<ReturnType<typeof extractFigmaStateTransitionCue>> } => Boolean(item.cue)) ?? null
}

function normalizeMatchText(value: string) {
  return value
    .replace(/页面/g, '界面')
    .replace(/\s+/g, '')
    .replace(/[《》「」『』"'`.,，。:：;；!！?？()[\]（）【】_\-\/\\]/g, '')
    .toLowerCase()
}

function groupAliases(group: FigmaSemanticGroup) {
  const aliases = new Set<string>()
  const add = (value: string | null | undefined) => {
    const normalized = normalizeMatchText(value ?? '')
    if (normalized.length >= 2) aliases.add(normalized)
  }
  add(group.label)
  for (const frame of group.frames) {
    add(frame.name)
    add(cleanupStateLabel(frame.name, group.label))
  }
  return [...aliases].sort((a, b) => b.length - a.length)
}

function findTargetGroupByHint(targetHint: string | null | undefined, groups: FigmaSemanticGroup[]) {
  const normalizedHint = normalizeMatchText(targetHint ?? '')
  if (normalizedHint.length < 2) return null

  return groups
    .map((group) => {
      const score = groupAliases(group).reduce((best, alias) => {
        if (alias === normalizedHint) return Math.max(best, 100 + alias.length)
        if (alias.length >= 2 && normalizedHint.includes(alias)) return Math.max(best, 80 + alias.length)
        if (normalizedHint.length >= 2 && alias.includes(normalizedHint)) return Math.max(best, 70 + normalizedHint.length)
        return best
      }, 0)
      return { group, score }
    })
    .filter((item) => item.score >= 72)
    .sort((a, b) => b.score - a.score)[0]?.group ?? null
}

function transitionKey(transition: FigmaUxMapTransition) {
  return [
    transition.sourceScreenId,
    transition.sourceStateId ?? '',
    transition.targetScreenId,
    transition.targetStateId ?? '',
    transition.trigger ?? '',
    transition.effect ?? '',
    transition.source,
  ].join('|')
}

function uniqueUxTransitions(transitions: FigmaUxMapTransition[]) {
  const seen = new Set<string>()
  return transitions.filter((transition) => {
    const key = transitionKey(transition)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildHeuristicFigmaUxMap(input: BuildFigmaUxMapInput): FigmaUxMap {
  const screenByGroupKey = new Map<string, FigmaUxMapScreen>()
  const states: FigmaUxMapState[] = []

  const screens = input.groups.map((group, index): FigmaUxMapScreen => {
    const primaryFrame = primaryFrameForGroup(group)
    const screen: FigmaUxMapScreen = {
      id: screenId(index, group),
      groupKey: group.key,
      label: group.label,
      sourceFrameIds: group.frames.map((frame) => frame.id),
      primaryFigmaNodeId: primaryFrame?.id ?? null,
      stateIds: [],
      evidence: uniqueTexts([
        `Figma 界面组：${group.label}`,
        ...group.frames.map((frame) => frame.name),
        ...group.frames.flatMap((frame) => frame.annotations ?? []),
      ], 10),
      confidence: Math.max(70, Math.min(96, Math.round(92 - Math.max(0, group.frames.length - 4) * 3))),
    }
    screenByGroupKey.set(group.key, screen)
    return screen
  })

  for (const group of input.groups) {
    const screen = screenByGroupKey.get(group.key)
    if (!screen) continue
    group.frames.forEach((frame, index) => {
      const classification = classifyFigmaUiState(frame.name, group.label, [
        ...frame.visibleTexts,
        ...(frame.annotations ?? []),
      ])
      const cue = frameCue(frame)
      const state: FigmaUxMapState = {
        id: stateId(screen, index, frame),
        screenId: screen.id,
        label: classification.label,
        role: uxStateRoleForKind(classification.kind),
        kind: classification.kind,
        figmaNodeId: frame.id,
        sourceUrl: frame.sourceUrl,
        previewImageUrl: frame.assetUrl ?? null,
        visibleTexts: uniqueTexts(frame.visibleTexts, 12),
        annotations: uniqueChineseAnnotations(frame.annotations ?? [], 8),
        triggerHints: cue ? uniqueTexts([cue.cue.trigger, cue.cue.effect], 4) : [],
        confidence: classification.confidence,
      }
      states.push(state)
      screen.stateIds.push(state.id)
    })
  }

  let transitionIndex = 0
  const transitions: FigmaUxMapTransition[] = []
  const pushTransition = (transition: Omit<FigmaUxMapTransition, 'id'>) => {
    transitionIndex += 1
    transitions.push({
      id: transitionId(transitionIndex, transition.sourceScreenId, transition.targetScreenId, transition.source),
      ...transition,
    })
  }

  for (const relation of input.relations) {
    const sourceScreen = screenByGroupKey.get(relation.sourceGroupKey)
    const targetScreen = screenByGroupKey.get(relation.targetGroupKey)
    if (!sourceScreen || !targetScreen || sourceScreen.id === targetScreen.id) continue
    pushTransition({
      sourceScreenId: sourceScreen.id,
      sourceStateId: null,
      targetScreenId: targetScreen.id,
      targetStateId: null,
      trigger: relation.label,
      condition: null,
      effect: `进入 ${targetScreen.label}`,
      evidence: uniqueTexts([relation.reason], 4),
      confidence: relation.confidence,
      source: normalizeUxTransitionSource(relation.source, 'figma_connector'),
    })
  }

  const ambiguities: FigmaUxMapAmbiguity[] = []
  let ambiguityIndex = 0
  const pushAmbiguity = (ambiguity: Omit<FigmaUxMapAmbiguity, 'id'>) => {
    ambiguityIndex += 1
    ambiguities.push({ id: ambiguityId(ambiguityIndex, ambiguity.kind), ...ambiguity })
  }

  for (const group of input.groups) {
    const sourceScreen = screenByGroupKey.get(group.key)
    if (!sourceScreen) continue
    const groupStates = states.filter((state) => state.screenId === sourceScreen.id)
    if (group.frames.length > 1 && groupStates.every((state) => state.kind === 'variant' && state.confidence < 72)) {
      pushAmbiguity({
        kind: 'state_role',
        message: `「${group.label}」包含 ${group.frames.length} 张状态图，但命名没有明确表达默认/浮层/加载/成功/失败等状态角色。`,
        screenId: sourceScreen.id,
        stateId: null,
        transitionId: null,
        evidence: group.frames.map((frame) => frame.name).slice(0, 8),
        severity: 'warning',
      })
    }

    for (const frame of group.frames) {
      const cue = frameCue(frame)
      const state = states.find((item) => item.figmaNodeId === frame.id)
      if (!cue) {
        if (state?.role === 'overlay') {
          pushAmbiguity({
            kind: 'missing_trigger',
            message: `「${frame.name}」看起来是浮层/弹窗状态，但未识别到打开它的触发条件。`,
            screenId: sourceScreen.id,
            stateId: state.id,
            transitionId: null,
            evidence: uniqueTexts([frame.name, ...(frame.annotations ?? [])], 6),
            severity: 'warning',
          })
        }
        continue
      }

      const targetGroup = findTargetGroupByHint(cue.cue.targetHint, input.groups) ?? group
      const targetScreen = screenByGroupKey.get(targetGroup.key) ?? sourceScreen
      const targetState = targetGroup.key === group.key ? state : states.find((item) => item.screenId === targetScreen.id)

      if (cue.cue.targetHint && targetGroup.key === group.key && !normalizeMatchText(frame.name).includes(normalizeMatchText(cue.cue.targetHint))) {
        const targetHint = cue.cue.targetHint
        const matchedOwnState = groupStates.find((item) => normalizeMatchText(item.label).includes(normalizeMatchText(targetHint)))
        if (!matchedOwnState && targetHint) {
          pushAmbiguity({
            kind: 'transition_target',
            message: `触发描述“${cue.cue.evidence}”没有稳定匹配到目标界面或状态。`,
            screenId: sourceScreen.id,
            stateId: state?.id ?? null,
            transitionId: null,
            evidence: [cue.cue.evidence],
            severity: 'warning',
          })
        }
      }

      pushTransition({
        sourceScreenId: sourceScreen.id,
        sourceStateId: null,
        targetScreenId: targetScreen.id,
        targetStateId: targetState?.id ?? null,
        trigger: cue.cue.trigger,
        condition: cue.cue.condition,
        effect: cue.cue.effect ?? (targetState ? `进入状态：${targetState.label}` : `进入 ${targetScreen.label}`),
        evidence: [cue.cue.evidence],
        confidence: cue.cue.confidence,
        source: frame.name === cue.text ? 'frame_title' : 'annotation',
      })
    }
  }

  if (screens.length > 1 && transitions.length === 0) {
    pushAmbiguity({
      kind: 'missing_trigger',
      message: 'Figma 中识别出多个界面，但未找到明确的界面流转或状态触发证据。',
      screenId: null,
      stateId: null,
      transitionId: null,
      evidence: screens.map((screen) => screen.label).slice(0, 8),
      severity: 'info',
    })
  }

  return {
    version: 'figma-ux-map.v1',
    review: {
      source: 'heuristic',
      confidence: screens.length ? 78 : 40,
      notes: [
        '由 Figma frame 分组、状态命名、近邻注释、连接线和 PRD 文本关系自动生成。',
        'AI 审阅可修正标签、状态角色和流转，但不得新增无证据界面。',
      ],
    },
    screens,
    states,
    transitions: uniqueUxTransitions(transitions),
    ambiguities,
  }
}

function normalizeScreenCandidate(value: unknown, fallback: FigmaUxMapScreen | null): FigmaUxMapScreen | null {
  if (!isRecord(value) && !fallback) return null
  const candidate = isRecord(value) ? value : {}
  const id = compact(candidate.id as string | undefined) || fallback?.id
  const groupKey = compact((candidate.groupKey ?? candidate.group_key) as string | undefined) || fallback?.groupKey
  const label = compact(candidate.label as string | undefined, 80) || fallback?.label
  if (!id || !groupKey || !label) return null
  return {
    id,
    groupKey,
    label,
    sourceFrameIds: textList(candidate.sourceFrameIds ?? candidate.source_frame_ids, 24).length
      ? textList(candidate.sourceFrameIds ?? candidate.source_frame_ids, 24)
      : (fallback?.sourceFrameIds ?? []),
    primaryFigmaNodeId: (compact((candidate.primaryFigmaNodeId ?? candidate.primary_figma_node_id) as string | undefined) || fallback?.primaryFigmaNodeId) ?? null,
    stateIds: textList(candidate.stateIds ?? candidate.state_ids, 40).length
      ? textList(candidate.stateIds ?? candidate.state_ids, 40)
      : (fallback?.stateIds ?? []),
    evidence: textList(candidate.evidence, 12).length ? textList(candidate.evidence, 12) : (fallback?.evidence ?? []),
    confidence: numberPercent(candidate.confidence, fallback?.confidence ?? 70),
  }
}

function normalizeStateCandidate(value: unknown, fallback: FigmaUxMapState | null, screenIds: Set<string>): FigmaUxMapState | null {
  if (!isRecord(value) && !fallback) return null
  const candidate = isRecord(value) ? value : {}
  const id = compact(candidate.id as string | undefined) || fallback?.id
  const screenId = compact((candidate.screenId ?? candidate.screen_id) as string | undefined) || fallback?.screenId
  const label = compact(candidate.label as string | undefined, 80) || fallback?.label
  const figmaNodeId = compact((candidate.figmaNodeId ?? candidate.figma_node_id) as string | undefined) || fallback?.figmaNodeId
  if (!id || !screenId || !screenIds.has(screenId) || !label || !figmaNodeId) return null
  const kind = normalizeUiStateKindForMap(candidate.kind, fallback?.kind ?? 'variant')
  const candidateAnnotations = uniqueChineseAnnotations(textList(candidate.annotations, 12), 8)
  const fallbackInteractionTips = (fallback?.annotations ?? [])
    .filter((text) => /^(Interaction tip:|交互提示：)/iu.test(text))
    .map((text) => text.replace(/^Interaction tip:\s*/iu, '交互提示：'))
  const fallbackAnnotations = uniqueChineseAnnotations(fallback?.annotations ?? [], 8)
  return {
    id,
    screenId,
    label,
    role: normalizeUxStateRole(candidate.role, fallback?.role ?? uxStateRoleForKind(kind)),
    kind,
    figmaNodeId,
    sourceUrl: (compact((candidate.sourceUrl ?? candidate.source_url) as string | undefined) || fallback?.sourceUrl) ?? null,
    previewImageUrl: (compact((candidate.previewImageUrl ?? candidate.preview_image_url) as string | undefined) || fallback?.previewImageUrl) ?? null,
    visibleTexts: textList(candidate.visibleTexts ?? candidate.visible_texts, 12).length
      ? textList(candidate.visibleTexts ?? candidate.visible_texts, 12)
      : (fallback?.visibleTexts ?? []),
    annotations: uniqueChineseAnnotations([
      ...fallbackInteractionTips,
      ...(candidateAnnotations.length ? candidateAnnotations : fallbackAnnotations),
    ], 8),
    triggerHints: textList(candidate.triggerHints ?? candidate.trigger_hints, 8).length
      ? textList(candidate.triggerHints ?? candidate.trigger_hints, 8)
      : (fallback?.triggerHints ?? []),
    confidence: numberPercent(candidate.confidence, fallback?.confidence ?? 70),
  }
}

function normalizeUiStateKindForMap(value: unknown, fallback: PrdUiStateKind): PrdUiStateKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KIND_LABELS, value)
    ? value as PrdUiStateKind
    : fallback
}

function normalizeTransitionCandidate(value: unknown, fallback: FigmaUxMapTransition | null, screenIds: Set<string>, stateIds: Set<string>): FigmaUxMapTransition | null {
  if (!isRecord(value) && !fallback) return null
  const candidate = isRecord(value) ? value : {}
  const id = compact(candidate.id as string | undefined) || fallback?.id
  const sourceScreenId = compact((candidate.sourceScreenId ?? candidate.source_screen_id) as string | undefined) || fallback?.sourceScreenId
  const targetScreenId = compact((candidate.targetScreenId ?? candidate.target_screen_id) as string | undefined) || fallback?.targetScreenId
  if (!id || !sourceScreenId || !targetScreenId || !screenIds.has(sourceScreenId) || !screenIds.has(targetScreenId)) return null
  const sourceStateId = (compact((candidate.sourceStateId ?? candidate.source_state_id) as string | undefined) || fallback?.sourceStateId) ?? null
  const targetStateId = (compact((candidate.targetStateId ?? candidate.target_state_id) as string | undefined) || fallback?.targetStateId) ?? null
  return {
    id,
    sourceScreenId,
    sourceStateId: sourceStateId && stateIds.has(sourceStateId) ? sourceStateId : null,
    targetScreenId,
    targetStateId: targetStateId && stateIds.has(targetStateId) ? targetStateId : null,
    trigger: (compact(candidate.trigger as string | undefined, 80) || fallback?.trigger) ?? null,
    condition: (compact(candidate.condition as string | undefined, 100) || fallback?.condition) ?? null,
    effect: (compact(candidate.effect as string | undefined, 100) || fallback?.effect) ?? null,
    evidence: textList(candidate.evidence, 8).length ? textList(candidate.evidence, 8) : (fallback?.evidence ?? []),
    confidence: numberPercent(candidate.confidence, fallback?.confidence ?? 65),
    source: normalizeUxTransitionSource(candidate.source, fallback?.source ?? 'ai_review'),
  }
}

function normalizeAmbiguityCandidate(value: unknown, fallback: FigmaUxMapAmbiguity | null, screenIds: Set<string>, stateIds: Set<string>, transitionIds: Set<string>): FigmaUxMapAmbiguity | null {
  if (!isRecord(value) && !fallback) return null
  const candidate = isRecord(value) ? value : {}
  const id = compact(candidate.id as string | undefined) || fallback?.id
  const message = compact(candidate.message as string | undefined, 180) || fallback?.message
  if (!id || !message) return null
  const screenId = (compact((candidate.screenId ?? candidate.screen_id) as string | undefined) || fallback?.screenId) ?? null
  const stateId = (compact((candidate.stateId ?? candidate.state_id) as string | undefined) || fallback?.stateId) ?? null
  const transitionId = (compact((candidate.transitionId ?? candidate.transition_id) as string | undefined) || fallback?.transitionId) ?? null
  const severity = candidate.severity === 'critical' || candidate.severity === 'warning' || candidate.severity === 'info'
    ? candidate.severity
    : (fallback?.severity ?? 'warning')
  return {
    id,
    kind: normalizeUxAmbiguityKind(candidate.kind, fallback?.kind ?? 'low_confidence'),
    message,
    screenId: screenId && screenIds.has(screenId) ? screenId : null,
    stateId: stateId && stateIds.has(stateId) ? stateId : null,
    transitionId: transitionId && transitionIds.has(transitionId) ? transitionId : null,
    evidence: textList(candidate.evidence, 8).length ? textList(candidate.evidence, 8) : (fallback?.evidence ?? []),
    severity,
  }
}

export function normalizeFigmaUxMap(value: unknown, fallback?: FigmaUxMap | null, reviewSource: FigmaUxMapReviewSource = 'ai_review'): FigmaUxMap | null {
  if (!isRecord(value)) return fallback ?? null
  const raw = isRecord(value.figmaUxMap) ? value.figmaUxMap : value
  if (!isRecord(raw)) return fallback ?? null

  const fallbackScreens = new Map((fallback?.screens ?? []).map((screen) => [screen.id, screen]))
  const fallbackStates = new Map((fallback?.states ?? []).map((state) => [state.id, state]))
  const rawScreens = Array.isArray(raw.screens) ? raw.screens : []
  const rawScreenById = new Map(rawScreens.filter(isRecord).map((screen) => [compact(screen.id as string | undefined), screen]).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>)
  const screenCandidates = fallback ? fallback.screens.map((screen) => rawScreenById.get(screen.id) ?? screen) : rawScreens
  const screens = screenCandidates
    .map((screen) => {
      const id = isRecord(screen) ? compact(screen.id as string | undefined) : ''
      return normalizeScreenCandidate(screen, id ? fallbackScreens.get(id) ?? null : null)
    })
    .filter((screen): screen is FigmaUxMapScreen => Boolean(screen))

  if (!screens.length) return fallback ?? null
  const screenIds = new Set(screens.map((screen) => screen.id))

  const rawStates = Array.isArray(raw.states) ? raw.states : []
  const rawStateById = new Map(rawStates.filter(isRecord).map((state) => [compact(state.id as string | undefined), state]).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>)
  const stateCandidates = fallback ? fallback.states.map((state) => rawStateById.get(state.id) ?? state) : rawStates
  const states = stateCandidates
    .map((state) => {
      const id = isRecord(state) ? compact(state.id as string | undefined) : ''
      return normalizeStateCandidate(state, id ? fallbackStates.get(id) ?? null : null, screenIds)
    })
    .filter((state): state is FigmaUxMapState => Boolean(state))
  const stateIds = new Set(states.map((state) => state.id))

  const stateIdsByScreen = new Map<string, string[]>()
  for (const state of states) {
    stateIdsByScreen.set(state.screenId, [...(stateIdsByScreen.get(state.screenId) ?? []), state.id])
  }
  screens.forEach((screen) => {
    screen.stateIds = (stateIdsByScreen.get(screen.id) ?? screen.stateIds).filter((stateId) => stateIds.has(stateId))
  })

  const fallbackTransitions = new Map((fallback?.transitions ?? []).map((transition) => [transition.id, transition]))
  const rawTransitions = Array.isArray(raw.transitions) ? raw.transitions : []
  const transitionCandidates = [
    ...(fallback ? fallback.transitions.map((transition) => {
      if (transition.source === 'figma_connector') return transition
      const replacement = rawTransitions.find((item) => isRecord(item) && item.id === transition.id)
      return replacement ?? transition
    }) : []),
    ...rawTransitions.filter((item) => isRecord(item) && !fallbackTransitions.has(String(item.id ?? ''))),
  ]
  const transitions = uniqueUxTransitions(transitionCandidates
    .map((transition) => {
      const id = isRecord(transition) ? compact(transition.id as string | undefined) : ''
      return normalizeTransitionCandidate(transition, id ? fallbackTransitions.get(id) ?? null : null, screenIds, stateIds)
    })
    .filter((transition): transition is FigmaUxMapTransition => Boolean(transition)))
  const transitionIds = new Set(transitions.map((transition) => transition.id))

  const fallbackAmbiguities = new Map((fallback?.ambiguities ?? []).map((ambiguity) => [ambiguity.id, ambiguity]))
  const rawAmbiguities = Array.isArray(raw.ambiguities) ? raw.ambiguities : []
  const ambiguityCandidates = [
    ...(fallback ? fallback.ambiguities.map((ambiguity) => {
      const replacement = rawAmbiguities.find((item) => isRecord(item) && item.id === ambiguity.id)
      return replacement ?? ambiguity
    }) : []),
    ...rawAmbiguities.filter((item) => isRecord(item) && !fallbackAmbiguities.has(String(item.id ?? ''))),
  ]
  const ambiguities = ambiguityCandidates
    .map((ambiguity) => {
      const id = isRecord(ambiguity) ? compact(ambiguity.id as string | undefined) : ''
      return normalizeAmbiguityCandidate(ambiguity, id ? fallbackAmbiguities.get(id) ?? null : null, screenIds, stateIds, transitionIds)
    })
    .filter((ambiguity): ambiguity is FigmaUxMapAmbiguity => Boolean(ambiguity))

  const rawReview = isRecord(raw.review) ? raw.review : {}
  return {
    version: 'figma-ux-map.v1',
    review: {
      source: normalizeUxReviewSource(rawReview.source, reviewSource),
      confidence: numberPercent(rawReview.confidence, fallback?.review.confidence ?? 74),
      notes: textList(rawReview.notes, 8).length
        ? textList(rawReview.notes, 8)
        : fallback?.review.notes ?? ['UX Map 已归一化。'],
    },
    screens,
    states,
    transitions,
    ambiguities,
  }
}
