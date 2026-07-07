import type { FigmaFrameImportResponse } from './api'
import type { ContentBlock } from '../types/chat'
import type { PrdNode, PrdTree, PrdUiStateKind } from '../types/prdNode'
import type { UXRequirementState } from '../types/uxRequirement'

interface PrototypeStateLike {
  prototypeHtml?: string | null
  prototypeVariants?: Array<{
    html?: string | null
    status?: string
    index: number
  }>
  selectedVariantIndex?: number
}

export interface FigmaDraftSource {
  url: string
  label: string
  origin: 'ui_state' | 'figma_preview'
  sourceId?: string | null
  stateKind?: PrdUiStateKind | null
  previewImageUrl?: string | null
  confidence?: number | null
}

interface FigmaPrototypeImageSelectionOptions {
  maxImages?: number
  maxDataChars?: number
}

const DEFAULT_FIGMA_PROTOTYPE_MAX_IMAGES = 4
const DEFAULT_FIGMA_PROTOTYPE_MAX_DATA_CHARS = 18 * 1024 * 1024

const UI_STATE_KIND_LABELS: Record<PrdUiStateKind, string> = {
  default: '默认态',
  overlay: '浮层态',
  loading: '加载态',
  success: '成功态',
  error: '错误态',
  empty: '空态',
  disabled: '禁用态',
  expanded: '展开态',
  collapsed: '收起态',
  localized: '多语言态',
  mirror: '镜像态',
  selected: '选中态',
  variant: '变体态',
}

function uiStateKindLabel(kind: PrdUiStateKind) {
  return UI_STATE_KIND_LABELS[kind] ?? UI_STATE_KIND_LABELS.variant
}

function compactText(value: string | null | undefined, maxLength = 120) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function firstMeaningfulText(...values: Array<string | null | undefined>) {
  return values.map((value) => compactText(value, 180)).find(Boolean) ?? ''
}

export function figmaDraftSourceKeyFromUrl(url: string | null | undefined) {
  return (url ?? '').trim().toLocaleLowerCase()
}

export function figmaDraftSourceKey(source: Pick<FigmaDraftSource, 'url'> | string | null | undefined) {
  if (typeof source === 'string') return figmaDraftSourceKeyFromUrl(source)
  return figmaDraftSourceKeyFromUrl(source?.url)
}

export function nodeHasGeneratedPrototype(state: PrototypeStateLike | undefined | null) {
  if (!state) return false
  if (state.prototypeHtml?.trim()) return true
  const selected = state.prototypeVariants?.find((variant) => variant.index === state.selectedVariantIndex)
  if (selected?.html?.trim()) return true
  return Boolean(state.prototypeVariants?.some((variant) => variant.status === 'complete' && variant.html?.trim()))
}

export function nodeHasPrototypeInFlight(state: PrototypeStateLike | undefined | null) {
  return Boolean(state?.prototypeVariants?.some((variant) => variant.status === 'pending' || variant.status === 'streaming'))
}

export function nodeHasPrototypeError(state: PrototypeStateLike | undefined | null) {
  if (nodeHasGeneratedPrototype(state) || nodeHasPrototypeInFlight(state)) return false
  return Boolean(state?.prototypeVariants?.some((variant) => variant.status === 'error'))
}

export function nodeHasGeneratedFigmaDraftSource(
  state: (PrototypeStateLike & { figmaDraftSourceKeys?: string[] }) | undefined | null,
  source: Pick<FigmaDraftSource, 'url'> | string | null | undefined,
) {
  const key = figmaDraftSourceKey(source)
  return Boolean(key && state?.figmaDraftSourceKeys?.includes(key))
}

function uniqueFigmaDraftSources(sources: FigmaDraftSource[]) {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = figmaDraftSourceKey(source)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getNodeFigmaDraftSources(node: PrdNode): FigmaDraftSource[] {
  const rankedStates = [...(node.uiStates ?? [])]
    .filter((state) => state.sourceUrl?.trim())
    .sort((a, b) => {
      const aDefault = a.kind === 'default' ? 1 : 0
      const bDefault = b.kind === 'default' ? 1 : 0
      return bDefault - aDefault || b.confidence - a.confidence || a.label.localeCompare(b.label)
    })
    .map((state): FigmaDraftSource => {
      const url = state.sourceUrl?.trim() ?? ''
      return {
        url,
        label: state.label,
        origin: 'ui_state',
        sourceId: state.id,
        stateKind: state.kind,
        previewImageUrl: state.previewImageUrl,
        confidence: state.confidence,
      }
    })

  const rankedPreviews = [...(node.figmaPreviews ?? [])]
    .filter((preview) => preview.sourceUrl?.trim())
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || a.name.localeCompare(b.name))
    .map((preview): FigmaDraftSource => {
      const url = preview.sourceUrl?.trim() ?? ''
      return {
        url,
        label: preview.name,
        origin: 'figma_preview',
        sourceId: preview.nodeId,
        stateKind: null,
        previewImageUrl: preview.imageUrl,
        confidence: preview.isPrimary ? 90 : 70,
      }
    })

  return uniqueFigmaDraftSources([...rankedStates, ...rankedPreviews])
}

export function getNodeFigmaDraftSource(node: PrdNode): FigmaDraftSource | null {
  return getNodeFigmaDraftSources(node)[0] ?? null
}

function selectFigmaPrototypeImages(
  result: FigmaFrameImportResponse,
  options: FigmaPrototypeImageSelectionOptions = {},
) {
  const maxImages = Math.max(1, options.maxImages ?? DEFAULT_FIGMA_PROTOTYPE_MAX_IMAGES)
  const maxDataChars = Math.max(1, options.maxDataChars ?? DEFAULT_FIGMA_PROTOTYPE_MAX_DATA_CHARS)
  const rankedImages = result.images
    .map((image, order) => ({ image, order }))
    .sort((a, b) => Number(b.image.depth === 0) - Number(a.image.depth === 0)
      || a.image.depth - b.image.depth
      || a.order - b.order)

  const selected: typeof rankedImages = []
  let selectedDataChars = 0
  for (const item of rankedImages) {
    if (selected.length >= maxImages) break
    const dataChars = item.image.data.length
    const wouldExceedBudget = selectedDataChars + dataChars > maxDataChars
    if (selected.length > 0 && wouldExceedBudget) continue
    selected.push(item)
    selectedDataChars += dataChars
  }
  return selected.map((item) => item.image)
}

export function figmaImportToPrototypeImages(
  result: FigmaFrameImportResponse,
  options: FigmaPrototypeImageSelectionOptions = {},
): ContentBlock[] {
  return selectFigmaPrototypeImages(result, options).map((image) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.data,
    },
  }))
}

export function buildFigmaDraftPrototypeInstruction(
  node: PrdNode,
  result: FigmaFrameImportResponse,
  source: FigmaDraftSource,
  hasExistingPrototype: boolean,
) {
  const action = hasExistingPrototype ? '基于当前 HTML 原型做增量更新' : '生成第一版草稿 HTML 原型'
  const numericSlotCount = result.images.reduce((sum, image) => sum + (image.numericTextSlots?.length ?? 0), 0)
  return [
    `请为 PRD 节点 ${node.id}（${node.label}）${action}，并以已绑定的 Figma 设计「${source.label}」作为视觉依据。`,
    `Figma 导入结果：${result.panelName}；共 ${result.imageCount} 张视觉证据图。需要保留 Figma 中的布局、层级、间距、色彩关系、组件位置和可见状态结构。`,
    '交互规则、数据状态、异常边界、文案意图和验收细节以 PRD 节点为准；不要把 Figma 示例数值当成真实业务数据。',
    numericSlotCount
      ? `Figma 中有 ${numericSlotCount} 个示例数值位置已被遮蔽；请在对应位置使用动态占位或 PRD 支持的数值，不要猜测还原示例数值。`
      : null,
    '输出可使用的移动端 HTML 原型，不要输出静态截图。只有当节点内容或 Figma 状态证据明确暗示交互时，才加入轻量交互。',
  ].filter(Boolean).join('\n')
}

export function buildFigmaDraftRequirement(
  node: PrdNode,
  tree: PrdTree,
  result: FigmaFrameImportResponse,
  source: FigmaDraftSource,
): UXRequirementState {
  const outgoingRefs = (node.references ?? [])
    .map((reference) => {
      const target = reference.targetNodeId ? tree[reference.targetNodeId] : null
      return [
        reference.label,
        target ? `目标界面：${target.label}` : null,
        reference.reason,
      ].filter(Boolean).join(' / ')
    })
    .filter(Boolean)
  const incomingRefs = Object.values(tree)
    .filter((candidate) => candidate.id !== node.id)
    .flatMap((candidate) => (candidate.references ?? [])
      .filter((reference) => reference.targetNodeId === node.id)
      .map((reference) => `${candidate.label} -> ${node.label}：${reference.label ?? reference.reason ?? '关联流程'}`))
  const stateLines = (node.uiStates ?? []).map((state) => [
    `${state.label}（${uiStateKindLabel(state.kind)}，置信度 ${state.confidence}%）`,
    state.visibleTexts.length ? `可见文案：${state.visibleTexts.slice(0, 5).join(' / ')}` : null,
    state.annotations.length ? `注释：${state.annotations.slice(0, 4).join(' / ')}` : null,
  ].filter(Boolean).join('; '))
  const transitionLines = (node.stateTransitions ?? []).map((transition) => [
    `${transition.sourceNodeId}${transition.sourceStateId ? `:${transition.sourceStateId}` : ''} -> ${transition.targetNodeId}${transition.targetStateId ? `:${transition.targetStateId}` : ''}`,
    transition.trigger ? `触发条件：${transition.trigger}` : null,
    transition.condition ? `生效条件：${transition.condition}` : null,
    transition.effect ? `影响结果：${transition.effect}` : null,
  ].filter(Boolean).join('; '))
  const imageLines = result.images.map((image, index) => (
    `${index + 1}. ${image.name} / ${image.type} / ${image.width}x${image.height} / 层级深度=${image.depth}`
  ))

  return {
    trigger_condition: `为 ${node.id}（${node.label}）生成基于 Figma 证据的第一版草稿原型。`,
    sequence_rules: [
      `节点摘要：${firstMeaningfulText(node.summary, node.content)}`,
      node.sections?.view?.content || node.sections?.view?.summary ? `画面细节：\n${node.sections.view.content ?? node.sections.view.summary}` : null,
      node.sections?.interaction?.content || node.sections?.interaction?.summary ? `交互细节：\n${node.sections.interaction.content ?? node.sections.interaction.summary}` : null,
      node.sections?.data?.content || node.sections?.data?.summary ? `数据细节：\n${node.sections.data.content ?? node.sections.data.summary}` : null,
      node.figmaUxMap ? `Figma UX Map：${node.figmaUxMap.screenLabel}；审阅来源：${node.figmaUxMap.reviewSource}；置信度：${node.figmaUxMap.reviewConfidence}%；备注：${node.figmaUxMap.notes.join(' / ')}` : null,
      stateLines.length ? `Figma 界面状态：\n${stateLines.join('\n')}` : null,
      transitionLines.length ? `Figma 状态流转：\n${transitionLines.join('\n')}` : null,
      outgoingRefs.length || incomingRefs.length ? `流程引用：\n${[...outgoingRefs, ...incomingRefs].join('\n')}` : null,
      `Figma 来源：${source.label}\n${result.summary}\n${imageLines.join('\n')}`,
    ].filter(Boolean).join('\n\n'),
    asset_dependencies: [
      {
        type: source.origin === 'ui_state' ? 'BoundFigmaUiState' : 'BoundFigmaPreview',
        path: source.url,
        is_ready: true,
      },
      ...result.images.slice(0, 6).map((image) => ({
        type: image.depth === 0 ? 'FigmaFrameImage' : 'FigmaChildImage',
        path: `${image.assetUrl} | ${image.name}`,
        is_ready: true,
      })),
    ],
    engine_constraints: node.techNotes ?? '构建可在浏览器运行的移动端 HTML 原型。外部资产仅限已提供的 Figma 证据或生成的 CSS。',
    ui_components: [],
    suggested_answers: [],
    completion_rate: node.status === 'done' ? 82 : 68,
    slot_confidence: {
      trigger_condition: 85,
      sequence_rules: 78,
      asset_dependencies: 82,
      engine_constraints: node.techNotes ? 70 : 55,
    },
    missing_reasons: {
      trigger_condition: null,
      sequence_rules: null,
      asset_dependencies: null,
      engine_constraints: node.techNotes ? null : '引擎和客户端约束仍需设计师确认。',
    },
    next_question: null,
    performance_spec: node.performanceSpec ?? null,
  }
}
