import type { FigmaFrameImportResponse } from './api'
import type { ContentBlock } from '../types/chat'
import type { PrdNode, PrdTree } from '../types/prdNode'
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
  previewImageUrl?: string | null
  confidence?: number | null
}

function compactText(value: string | null | undefined, maxLength = 120) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function firstMeaningfulText(...values: Array<string | null | undefined>) {
  return values.map((value) => compactText(value, 180)).find(Boolean) ?? ''
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

export function getNodeFigmaDraftSource(node: PrdNode): FigmaDraftSource | null {
  const rankedStates = [...(node.uiStates ?? [])]
    .filter((state) => state.sourceUrl?.trim())
    .sort((a, b) => {
      const aDefault = a.kind === 'default' ? 1 : 0
      const bDefault = b.kind === 'default' ? 1 : 0
      return bDefault - aDefault || b.confidence - a.confidence || a.label.localeCompare(b.label)
    })

  const state = rankedStates[0]
  if (state?.sourceUrl?.trim()) {
    return {
      url: state.sourceUrl.trim(),
      label: state.label,
      origin: 'ui_state',
      previewImageUrl: state.previewImageUrl,
      confidence: state.confidence,
    }
  }

  const rankedPreviews = [...(node.figmaPreviews ?? [])]
    .filter((preview) => preview.sourceUrl?.trim())
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || a.name.localeCompare(b.name))
  const preview = rankedPreviews[0]
  if (preview?.sourceUrl?.trim()) {
    return {
      url: preview.sourceUrl.trim(),
      label: preview.name,
      origin: 'figma_preview',
      previewImageUrl: preview.imageUrl,
      confidence: preview.isPrimary ? 90 : 70,
    }
  }

  return null
}

export function figmaImportToPrototypeImages(result: FigmaFrameImportResponse): ContentBlock[] {
  return result.images.slice(0, 6).map((image) => ({
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
  const action = hasExistingPrototype ? 'incrementally update the current HTML prototype' : 'generate the first draft HTML prototype'
  const numericSlotCount = result.images.reduce((sum, image) => sum + (image.numericTextSlots?.length ?? 0), 0)
  return [
    `${action} for PRD node ${node.id} (${node.label}) using the bound Figma design "${source.label}" as the visual source of truth.`,
    `Figma import: ${result.panelName}; ${result.imageCount} visual evidence image(s). Preserve layout, hierarchy, spacing, color relationships, component placement, and visible state structure from Figma.`,
    'Use the PRD node for interaction rules, data states, edge cases, copy intent, and acceptance details. Do not treat sample Figma numbers as real business data.',
    numericSlotCount
      ? `${numericSlotCount} numeric sample value(s) were redacted from Figma; add dynamic placeholders or PRD-backed values at the corresponding locations instead of restoring guessed values.`
      : null,
    'Output a usable mobile HTML prototype, not a static screenshot. Add lightweight interactions only when they are implied by the node content or Figma state evidence.',
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
        target ? `target=${target.label}` : null,
        reference.reason,
      ].filter(Boolean).join(' / ')
    })
    .filter(Boolean)
  const incomingRefs = Object.values(tree)
    .filter((candidate) => candidate.id !== node.id)
    .flatMap((candidate) => (candidate.references ?? [])
      .filter((reference) => reference.targetNodeId === node.id)
      .map((reference) => `${candidate.label} -> ${node.label}: ${reference.label ?? reference.reason ?? 'linked flow'}`))
  const stateLines = (node.uiStates ?? []).map((state) => [
    `${state.label} (${state.kind}, confidence ${state.confidence}%)`,
    state.visibleTexts.length ? `texts=${state.visibleTexts.slice(0, 5).join(' / ')}` : null,
    state.annotations.length ? `annotations=${state.annotations.slice(0, 4).join(' / ')}` : null,
  ].filter(Boolean).join('; '))
  const transitionLines = (node.stateTransitions ?? []).map((transition) => [
    `${transition.sourceNodeId}${transition.sourceStateId ? `:${transition.sourceStateId}` : ''} -> ${transition.targetNodeId}${transition.targetStateId ? `:${transition.targetStateId}` : ''}`,
    transition.trigger ? `trigger=${transition.trigger}` : null,
    transition.condition ? `condition=${transition.condition}` : null,
    transition.effect ? `effect=${transition.effect}` : null,
  ].filter(Boolean).join('; '))
  const imageLines = result.images.map((image, index) => (
    `${index + 1}. ${image.name} / ${image.type} / ${image.width}x${image.height} / depth=${image.depth}`
  ))

  return {
    trigger_condition: `Generate a Figma-backed first draft prototype for ${node.id} (${node.label}).`,
    sequence_rules: [
      `Node summary: ${firstMeaningfulText(node.summary, node.content)}`,
      node.sections?.view?.content || node.sections?.view?.summary ? `View details:\n${node.sections.view.content ?? node.sections.view.summary}` : null,
      node.sections?.interaction?.content || node.sections?.interaction?.summary ? `Interaction details:\n${node.sections.interaction.content ?? node.sections.interaction.summary}` : null,
      node.sections?.data?.content || node.sections?.data?.summary ? `Data details:\n${node.sections.data.content ?? node.sections.data.summary}` : null,
      node.figmaUxMap ? `Figma UX map: ${node.figmaUxMap.screenLabel}; review=${node.figmaUxMap.reviewSource}; confidence=${node.figmaUxMap.reviewConfidence}%; notes=${node.figmaUxMap.notes.join(' / ')}` : null,
      stateLines.length ? `Figma UI states:\n${stateLines.join('\n')}` : null,
      transitionLines.length ? `Figma transitions:\n${transitionLines.join('\n')}` : null,
      outgoingRefs.length || incomingRefs.length ? `Flow references:\n${[...outgoingRefs, ...incomingRefs].join('\n')}` : null,
      `Figma source: ${source.label}\n${result.summary}\n${imageLines.join('\n')}`,
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
    engine_constraints: node.techNotes ?? 'Build a browser-runnable mobile HTML prototype. Keep external assets limited to the provided Figma evidence or generated CSS.',
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
      engine_constraints: node.techNotes ? null : 'Engine/client constraints still need designer confirmation.',
    },
    next_question: null,
    performance_spec: node.performanceSpec ?? null,
  }
}
