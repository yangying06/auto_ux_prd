/**
 * PrdNode tree & document normalization helpers.
 *
 * Extracted from src/store/appStore.ts. Pure transforms with no store
 * dependency, used during persistence migration and runtime patch application.
 */
import type {
  FigmaUxMapReviewSource,
    PrdNode,
  PrdNodeBackendContractRef,
  PrdNodeDocumentField,
  PrdNodeDocumentSnapshot,
  PrdNodeEvidenceRef,
  PrdNodeFigmaPreview,
  PrdNodeFigmaUxMapSlice,
  PrdNodeOperationSuggestion,
  PrdNodePolishRevision,
  PrdNodeReference,
  PrdNodeSectionKey,
  PrdStateTransition,
  PrdTree,
  PrdUiState,
  UpdateNodePatch,
} from '../../types/prdNode'
import type { ProjectWorkflowState } from '../../types/projectWorkflow'
import { defaultProjectWorkflow } from '../../types/projectWorkflow'
import {
  isRecord,
  normalizeOptionalText,
  normalizeTextList,
  normalizeConfidencePercent,
  normalizeWorkflowStringArray,
} from './text'

import {
  defaultAudienceForSpecLens,
  normalizeLegacyAudience,
  normalizeNodeLensFields,
  specLensFromLegacyAudience,
} from '../../lib/prdNodeLens'
import { normalizePerformanceSpec } from '../../lib/performanceOrchestration'
import type { ProjectIterationContext, ProjectWorkflowMode } from '../../types/projectWorkflow'


const PRD_SECTION_KEYS = ['data', 'interaction', 'view'] as const satisfies readonly PrdNodeSectionKey[]

const DOCUMENT_FIELDS: PrdNodeDocumentField[] = [
  'summary',
  'content',
  'techNotes',
  'sections',
  'handoffGoal',
  'qualityGate',
  'backendContracts',
  'evidenceRefs',
  'performanceSpec',
]

const UI_STATE_KINDS = new Set<PrdUiState['kind']>([
  'default',
  'overlay',
  'loading',
  'success',
  'error',
  'empty',
  'disabled',
  'expanded',
  'collapsed',
  'localized',
  'mirror',
  'selected',
  'variant',
])

const FIGMA_UX_MAP_REVIEW_SOURCES = new Set<FigmaUxMapReviewSource>([
  'heuristic',
  'ai_review',
  'ai_review_fallback',
])


export function createDocumentSnapshot(node: PrdNode): PrdNodeDocumentSnapshot {
  return {
    summary: node.summary,
    content: node.content,
    techNotes: node.techNotes,
    sections: node.sections,
    handoffGoal: node.handoffGoal,
    qualityGate: node.qualityGate,
    backendContracts: node.backendContracts,
    evidenceRefs: node.evidenceRefs,
    performanceSpec: node.performanceSpec,
  }
}


export function changedDocumentFields(before: PrdNodeDocumentSnapshot, after: PrdNodeDocumentSnapshot): PrdNodeDocumentField[] {
  return DOCUMENT_FIELDS.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
}


export function createNodePolishRevision(nodeId: string, before: PrdNodeDocumentSnapshot, after: PrdNodeDocumentSnapshot): PrdNodePolishRevision | null {
  const changedFields = changedDocumentFields(before, after)
  if (!changedFields.length) return null
  return {
    id: `${Date.now()}-${nodeId}`,
    nodeId,
    createdAt: new Date().toISOString(),
    before,
    after,
    changedFields,
    accepted: false,
  }
}


export function normalizeReferences(value: PrdNodeReference[] | null | undefined): PrdNodeReference[] {
  if (!Array.isArray(value)) return []
  return value
    .map((reference) => ({
      targetNodeId: normalizeOptionalText(reference.targetNodeId),
      label: normalizeOptionalText(reference.label) ?? '跨页面引用',
      reason: normalizeOptionalText(reference.reason),
      sourceNodeId: normalizeOptionalText(reference.sourceNodeId),
    }))
    .filter((reference) => reference.targetNodeId || reference.label)
}


export function normalizeUiStateKind(value: unknown): PrdUiState['kind'] {
  return typeof value === 'string' && UI_STATE_KINDS.has(value as PrdUiState['kind'])
    ? value as PrdUiState['kind']
    : 'variant'
}

function normalizeDimension(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}


export function normalizeFigmaPreviews(value: PrdNodeFigmaPreview[] | null | undefined): PrdNodeFigmaPreview[] | undefined {
  if (!Array.isArray(value)) return undefined
  const previews = value
    .map((preview): PrdNodeFigmaPreview | null => {
      if (!preview || typeof preview !== 'object') return null
      const candidate = preview as unknown as Record<string, unknown>
      const nodeId = normalizeOptionalText(candidate.nodeId ?? candidate.figmaNodeId ?? candidate.node_id)
      const name = normalizeOptionalText(candidate.name ?? candidate.label)
      const sourceUrl = normalizeOptionalText(candidate.sourceUrl ?? candidate.source_url)
      if (!nodeId || !name || !sourceUrl) return null
      return {
        nodeId,
        name,
        sourceUrl,
        imageUrl: normalizeOptionalText(candidate.imageUrl ?? candidate.image_url),
        width: normalizeDimension(candidate.width),
        height: normalizeDimension(candidate.height),
        originNodeId: normalizeOptionalText(candidate.originNodeId ?? candidate.origin_node_id),
        originNodeLabel: normalizeOptionalText(candidate.originNodeLabel ?? candidate.origin_node_label),
        isPrimary: typeof candidate.isPrimary === 'boolean' ? candidate.isPrimary : undefined,
        userAdded: typeof candidate.userAdded === 'boolean' ? candidate.userAdded : undefined,
        userNote: normalizeOptionalText(candidate.userNote ?? candidate.user_note),
      }
    })
    .filter((preview): preview is PrdNodeFigmaPreview => Boolean(preview))
  return previews.length ? previews : undefined
}


export function normalizeUiStates(value: PrdUiState[] | null | undefined): PrdUiState[] | undefined {
  if (!Array.isArray(value)) return undefined
  const states = value
    .map((state, index): PrdUiState | null => {
      if (!state || typeof state !== 'object') return null
      const candidate = state as unknown as Record<string, unknown>
      const figmaNodeId = normalizeOptionalText(candidate.figmaNodeId ?? candidate.nodeId ?? candidate.node_id)
      const label = normalizeOptionalText(candidate.label ?? candidate.name)
      if (!figmaNodeId || !label) return null
      return {
        id: normalizeOptionalText(candidate.id) ?? `state-${index + 1}`,
        label,
        kind: normalizeUiStateKind(candidate.kind),
        figmaNodeId,
        sourceUrl: normalizeOptionalText(candidate.sourceUrl ?? candidate.source_url),
        previewImageUrl: normalizeOptionalText(candidate.previewImageUrl ?? candidate.preview_image_url ?? candidate.imageUrl ?? candidate.image_url),
        visibleTexts: normalizeTextList(candidate.visibleTexts ?? candidate.visible_texts),
        annotations: normalizeTextList(candidate.annotations),
        confidence: normalizeConfidencePercent(candidate.confidence),
      }
    })
    .filter((state): state is PrdUiState => Boolean(state))
  return states.length ? states : undefined
}


export function normalizeStateTransitions(value: PrdStateTransition[] | null | undefined): PrdStateTransition[] | undefined {
  if (!Array.isArray(value)) return undefined
  const transitions = value
    .map((transition, index): PrdStateTransition | null => {
      if (!transition || typeof transition !== 'object') return null
      const candidate = transition as unknown as Record<string, unknown>
      const sourceNodeId = normalizeOptionalText(candidate.sourceNodeId ?? candidate.source_node_id)
      const targetNodeId = normalizeOptionalText(candidate.targetNodeId ?? candidate.target_node_id)
      if (!sourceNodeId || !targetNodeId) return null
      return {
        id: normalizeOptionalText(candidate.id) ?? `transition-${index + 1}`,
        sourceNodeId,
        sourceStateId: normalizeOptionalText(candidate.sourceStateId ?? candidate.source_state_id),
        targetNodeId,
        targetStateId: normalizeOptionalText(candidate.targetStateId ?? candidate.target_state_id),
        trigger: normalizeOptionalText(candidate.trigger),
        condition: normalizeOptionalText(candidate.condition),
        effect: normalizeOptionalText(candidate.effect),
        evidence: normalizeTextList(candidate.evidence, 8),
        confidence: normalizeConfidencePercent(candidate.confidence, 65),
        source: normalizeOptionalText(candidate.source) as PrdStateTransition['source'],
      }
    })
    .filter((transition): transition is PrdStateTransition => Boolean(transition))
  return transitions.length ? transitions : undefined
}


export function normalizeFigmaUxMapReviewSource(value: unknown): FigmaUxMapReviewSource {
  return typeof value === 'string' && FIGMA_UX_MAP_REVIEW_SOURCES.has(value as FigmaUxMapReviewSource)
    ? value as FigmaUxMapReviewSource
    : 'heuristic'
}


export function normalizeNodeFigmaUxMap(value: PrdNodeFigmaUxMapSlice | null | undefined): PrdNodeFigmaUxMapSlice | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as unknown as Record<string, unknown>
  const screenId = normalizeOptionalText(candidate.screenId ?? candidate.screen_id)
  const screenLabel = normalizeOptionalText(candidate.screenLabel ?? candidate.screen_label)
  if (!screenId || !screenLabel) return undefined
  return {
    screenId,
    screenLabel,
    sourceFrameIds: normalizeTextList(candidate.sourceFrameIds ?? candidate.source_frame_ids, 12),
    stateIds: normalizeTextList(candidate.stateIds ?? candidate.state_ids, 24),
    transitionIds: normalizeTextList(candidate.transitionIds ?? candidate.transition_ids, 24),
    ambiguityIds: normalizeTextList(candidate.ambiguityIds ?? candidate.ambiguity_ids, 24),
    reviewSource: normalizeFigmaUxMapReviewSource(candidate.reviewSource ?? candidate.review_source),
    reviewConfidence: normalizeConfidencePercent(candidate.reviewConfidence ?? candidate.review_confidence, 70),
    notes: normalizeTextList(candidate.notes, 8),
  }
}


export function normalizeBackendContracts(value: PrdNodeBackendContractRef[] | null | undefined): PrdNodeBackendContractRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const contracts = value
    .map((contract) => ({
      id: normalizeOptionalText(contract.id),
      title: normalizeOptionalText(contract.title) ?? '未命名服务端依赖',
      kind: contract.kind,
      summary: normalizeOptionalText(contract.summary),
      fields: Array.isArray(contract.fields) ? contract.fields.map((field) => field.trim()).filter(Boolean) : undefined,
      targetNodeId: normalizeOptionalText(contract.targetNodeId),
      evidenceRefs: contract.evidenceRefs,
    }))
    .filter((contract) => ['api', 'config', 'server', 'data'].includes(contract.kind))
  return contracts.length ? contracts : undefined
}


export function evidenceRefKey(ref: PrdNodeEvidenceRef) {
  return `${ref.sourceKind}:${ref.sourceLabel}:${ref.quote ?? ''}`
}


export function uniqueEvidenceRefs(refs: PrdNodeEvidenceRef[]) {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = evidenceRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}


export function normalizeOpenQuestions(value: string[] | null | undefined) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}


export function mergePolishSections(
  current: PrdNode['sections'] | undefined,
  patch: PrdNode['sections'] | undefined,
): PrdNode['sections'] | undefined {
  if (!patch || Object.keys(patch).length === 0) return current

  const next: PrdNode['sections'] = { ...(current ?? {}) }
  let touched = false

  for (const key of PRD_SECTION_KEYS) {
    const incoming = patch[key]
    if (!incoming) continue

    const existing = next[key]
    const title = normalizeOptionalText(incoming.title)
    const summary = normalizeOptionalText(incoming.summary)
    const content = normalizeOptionalText(incoming.content)
    const evidenceRefs = Array.isArray(incoming.evidenceRefs) ? incoming.evidenceRefs : []
    const openQuestions = normalizeOpenQuestions(incoming.openQuestions)
    const hasSubstance = Boolean(summary || content || evidenceRefs.length || openQuestions.length)

    if (!title && !hasSubstance) continue
    if (!existing && !hasSubstance) continue

    next[key] = {
      title: title ?? existing?.title ?? null,
      summary: summary ?? existing?.summary ?? null,
      content: content ?? existing?.content ?? null,
      evidenceRefs: evidenceRefs.length
        ? uniqueEvidenceRefs([...(existing?.evidenceRefs ?? []), ...evidenceRefs])
        : existing?.evidenceRefs ?? [],
      openQuestions: Array.isArray(incoming.openQuestions) && hasSubstance
        ? openQuestions
        : existing?.openQuestions ?? [],
    }
    touched = true
  }

  return touched ? next : current
}


export function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>
}


export function hasMeaningfulText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}


export function repairNodeFromRevision(node: Partial<PrdNode>, revision: PrdNodePolishRevision | undefined): Partial<PrdNode> {
  if (!revision) return node
  const repaired = { ...node }
  const fallback = revision.after ?? revision.before
  const before = revision.before

  if (!hasMeaningfulText(repaired.summary)) repaired.summary = fallback.summary || before.summary || repaired.summary
  if (!hasMeaningfulText(repaired.content)) repaired.content = fallback.content || before.content || repaired.content
  if (repaired.techNotes === undefined) repaired.techNotes = fallback.techNotes ?? before.techNotes ?? null
  if (repaired.sections === undefined || Object.keys(repaired.sections ?? {}).length === 0) {
    repaired.sections = fallback.sections ?? before.sections ?? repaired.sections
  }
  if (repaired.handoffGoal === undefined) repaired.handoffGoal = fallback.handoffGoal ?? before.handoffGoal ?? null
  if (repaired.qualityGate === undefined) repaired.qualityGate = fallback.qualityGate ?? before.qualityGate ?? null
  if (repaired.backendContracts === undefined) repaired.backendContracts = fallback.backendContracts ?? before.backendContracts
  if (repaired.evidenceRefs === undefined) repaired.evidenceRefs = fallback.evidenceRefs ?? before.evidenceRefs
  if (repaired.performanceSpec === undefined) repaired.performanceSpec = fallback.performanceSpec ?? before.performanceSpec

  return repaired
}


export function makePageNodeId(tree: PrdTree | null, title: string) {
  const slug = title
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[<>:"|?*\x00-\x1F]/g, '')
    .slice(0, 24)
  const base = `PAGE-${slug || Date.now().toString(36)}`
  let id = base
  let index = 2
  while (tree?.[id]) {
    id = `${base}-${index}`
    index += 1
  }
  return id
}


export function collectDescendantIds(tree: PrdTree, nodeId: string) {
  const ids = new Set<string>()
  const visit = (id: string) => {
    if (ids.has(id)) return
    ids.add(id)
    for (const childId of tree[id]?.children ?? []) visit(childId)
  }
  visit(nodeId)
  return ids
}


export function sanitizePatch(patch: UpdateNodePatch): UpdateNodePatch {
  const specLens = patch.specLens ?? specLensFromLegacyAudience(patch.audience)
  const audience = normalizeLegacyAudience(patch.audience) ?? defaultAudienceForSpecLens(specLens) ?? patch.audience
  return {
    ...patch,
    label: patch.label?.trim() || undefined,
    summary: patch.summary?.trim() || undefined,
    content: patch.content?.trim() || undefined,
    docPath: patch.docPath === undefined ? undefined : normalizeOptionalText(patch.docPath),
    references: patch.references ? normalizeReferences(patch.references) : undefined,
    techNotes: patch.techNotes === undefined ? undefined : normalizeOptionalText(patch.techNotes),
    audience,
    specLens,
    sections: patch.sections,
    handoffGoal: patch.handoffGoal === undefined ? undefined : normalizeOptionalText(patch.handoffGoal),
    qualityGate: patch.qualityGate === undefined ? undefined : normalizeOptionalText(patch.qualityGate),
    backendContracts: patch.backendContracts === undefined ? undefined : normalizeBackendContracts(patch.backendContracts),
    sourceKind: patch.sourceKind,
    evidenceRefs: patch.evidenceRefs,
    performanceSpec: patch.performanceSpec === undefined ? undefined : normalizePerformanceSpec(patch.performanceSpec),
    figmaPreviews: patch.figmaPreviews,
    uiStates: patch.uiStates === undefined ? undefined : normalizeUiStates(patch.uiStates),
    stateTransitions: patch.stateTransitions === undefined ? undefined : normalizeStateTransitions(patch.stateTransitions),
    figmaUxMap: patch.figmaUxMap === undefined ? undefined : normalizeNodeFigmaUxMap(patch.figmaUxMap),
  }
}


export function appendAdjustmentBlock(existing: string | null | undefined, addition: string | null | undefined, heading: string) {
  const current = normalizeOptionalText(existing) ?? ''
  const next = normalizeOptionalText(addition)
  if (!next) return current
  if (current.includes(next)) return current
  const block = `## ${heading}\n\n${next}`
  return current ? `${current.trim()}\n\n${block}` : next
}


export function mergeSectionAdjustment(
  current: PrdNode['sections'] | undefined,
  patch: PrdNode['sections'] | undefined,
): PrdNode['sections'] | undefined {
  if (!patch || Object.keys(patch).length === 0) return current
  const next: PrdNode['sections'] = { ...(current ?? {}) }
  for (const key of ['data', 'interaction', 'view'] as const) {
    const incoming = patch[key]
    if (!incoming) continue
    const existing = next[key]
    next[key] = {
      title: incoming.title ?? existing?.title ?? null,
      summary: appendAdjustmentBlock(existing?.summary, incoming.summary, '用户反馈补充'),
      content: appendAdjustmentBlock(existing?.content, incoming.content, '用户反馈补充'),
      evidenceRefs: [
        ...(existing?.evidenceRefs ?? []),
        ...(incoming.evidenceRefs ?? []),
      ],
      openQuestions: Array.from(new Set([
        ...(existing?.openQuestions ?? []),
        ...(incoming.openQuestions ?? []),
      ])),
    }
  }
  return next
}


export function mergeBackendContractAdjustment(
  current: PrdNodeBackendContractRef[] | undefined,
  patch: PrdNodeBackendContractRef[] | undefined,
) {
  const normalizedPatch = normalizeBackendContracts(patch)
  if (!normalizedPatch?.length) return current
  return [...(current ?? []), ...normalizedPatch]
}


export function mergeMapAdjustmentPatch(node: PrdNode, patch: UpdateNodePatch): PrdNode {
  const sanitized = sanitizePatch(patch)
  return normalizePrdTreeNode({
    ...node,
    label: sanitized.label ?? node.label,
    status: sanitized.status ?? (node.status === 'done' ? 'done' : 'pending_refine'),
    type: sanitized.type ?? node.type,
    needsPolish: node.needsPolish,
    docPath: sanitized.docPath ?? node.docPath,
    audience: sanitized.audience ?? node.audience,
    specLens: sanitized.specLens ?? node.specLens,
    sourceKind: sanitized.sourceKind ?? node.sourceKind,
    references: sanitized.references
      ? normalizeReferences([...(node.references ?? []), ...sanitized.references])
      : node.references,
    summary: appendAdjustmentBlock(node.summary, sanitized.summary, '用户反馈补充'),
    content: appendAdjustmentBlock(node.content, sanitized.content, '用户反馈调整'),
    techNotes: appendAdjustmentBlock(node.techNotes, sanitized.techNotes, '用户反馈技术补充') || null,
    sections: mergeSectionAdjustment(node.sections, sanitized.sections),
    handoffGoal: appendAdjustmentBlock(node.handoffGoal, sanitized.handoffGoal, '用户反馈补充') || null,
    qualityGate: appendAdjustmentBlock(node.qualityGate, sanitized.qualityGate, '用户反馈补充') || null,
    backendContracts: mergeBackendContractAdjustment(node.backendContracts, sanitized.backendContracts),
    evidenceRefs: sanitized.evidenceRefs
      ? [...(node.evidenceRefs ?? []), ...sanitized.evidenceRefs]
      : node.evidenceRefs,
    performanceSpec: sanitized.performanceSpec ?? node.performanceSpec,
    figmaPreviews: sanitized.figmaPreviews ?? node.figmaPreviews,
    uiStates: sanitized.uiStates ?? node.uiStates,
    stateTransitions: sanitized.stateTransitions ?? node.stateTransitions,
    figmaUxMap: sanitized.figmaUxMap === undefined ? node.figmaUxMap : sanitized.figmaUxMap,
  })
}


export function makeSuggestionNodeId(tree: PrdTree, suggestion: PrdNodeOperationSuggestion) {
  const label = suggestion.patch.label ?? '补充节点'
  const slug = label
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[<>:"|?*\x00-\x1F]/g, '')
    .slice(0, 24)
  const base = `${suggestion.parentId ?? 'NODE'}-${slug || Date.now().toString(36)}`.slice(0, 48)
  let id = base
  let index = 2
  while (tree[id]) {
    id = `${base}-${index}`
    index += 1
  }
  return id
}


export function emptyProjectWorkflowState(): ProjectWorkflowState {
  return { mode: defaultProjectWorkflow.mode, iteration: null }
}


export function normalizeProjectWorkflow(value: unknown): ProjectWorkflowState {
  if (!isRecord(value)) return emptyProjectWorkflowState()
  const mode: ProjectWorkflowMode = value.mode === 'existing_project_iteration'
    ? 'existing_project_iteration'
    : 'new_project'
  if (mode === 'new_project') return emptyProjectWorkflowState()

  const rawIteration = isRecord(value.iteration) ? value.iteration : null
  if (!rawIteration) return { mode, iteration: null }

  const iteration: ProjectIterationContext = {
    codebasePath: normalizeOptionalText(rawIteration.codebasePath) ?? '',
    focus: normalizeOptionalText(rawIteration.focus) ?? '',
    baselineScan: isRecord(rawIteration.baselineScan) ? rawIteration.baselineScan as unknown as ProjectIterationContext['baselineScan'] : null,
    platformStrategyNotes: normalizeWorkflowStringArray(rawIteration.platformStrategyNotes),
    acceptanceFocus: normalizeWorkflowStringArray(rawIteration.acceptanceFocus),
  }
  return { mode, iteration }
}


export function persistedTreeHasLocalTemplates(value: unknown) {
  if (!isRecord(value)) return false

  return Object.values(value).some((node) => {
    if (!isRecord(node)) return false
    const text = [
      node.id,
      node.summary,
      node.content,
      node.techNotes,
      node.handoffGoal,
      node.qualityGate,
      node.extractedFrom,
    ].filter((item): item is string => typeof item === 'string').join('\n')

    return /原文标题「.+?」下的内容。/.test(text)
      || /本地标题骨架|本地兜底节点|标题骨架兜底/.test(text)
  })
}


export function rebuildPrdTreeLinks(tree: PrdTree): PrdTree {
  const next = Object.fromEntries(
    Object.entries(tree).map(([id, node]) => [id, { ...node, children: [] }])
  ) as PrdTree

  for (const node of Object.values(next)) {
    if (node.parentId && next[node.parentId]) {
      next[node.parentId].children.push(node.id)
    }
  }

  for (const node of Object.values(next)) {
    node.children.sort((a, b) => (next[a]?.order ?? 0) - (next[b]?.order ?? 0))
  }

  return next
}


export function normalizePrdTreeNode(node: PrdNode): PrdNode {
  return normalizeNodeLensFields({
    ...node,
    id: node.id,
    parentId: typeof node.parentId === 'string' ? node.parentId : null,
    label: normalizeOptionalText(node.label) ?? node.id,
    summary: normalizeOptionalText(node.summary) ?? '',
    content: normalizeOptionalText(node.content) ?? normalizeOptionalText(node.summary) ?? '',
    type: node.type ?? 'feature',
    status: node.status ?? 'pending',
    level: typeof node.level === 'number' ? node.level : 0,
    order: typeof node.order === 'number' ? node.order : 0,
    needsPolish: typeof node.needsPolish === 'boolean' ? node.needsPolish : node.type === 'page' || node.type === 'ui',
    extractedFrom: node.extractedFrom ?? null,
    techNotes: node.techNotes ?? null,
    children: Array.isArray(node.children) ? node.children : [],
    references: normalizeReferences(node.references),
    sections: node.sections ?? {},
    backendContracts: normalizeBackendContracts(node.backendContracts),
    performanceSpec: normalizePerformanceSpec(node.performanceSpec),
    figmaPreviews: normalizeFigmaPreviews(node.figmaPreviews),
    uiStates: normalizeUiStates(node.uiStates),
    stateTransitions: normalizeStateTransitions(node.stateTransitions),
    figmaUxMap: normalizeNodeFigmaUxMap(node.figmaUxMap),
  })
}


export function normalizePersistedPrdTree(value: unknown, revisions?: unknown): PrdTree | null {
  if (!isRecord(value)) return null
  if (persistedTreeHasLocalTemplates(value)) return null
  const revisionMap = isRecord(revisions) ? revisions as Record<string, PrdNodePolishRevision> : {}
  const normalized = Object.fromEntries(
    Object.entries(value).map(([id, rawNode]) => {
      const node = repairNodeFromRevision({ ...(rawNode as PrdNode), id }, revisionMap[id]) as PrdNode
      return [id, normalizePrdTreeNode(node)]
    })
  ) as PrdTree
  return rebuildPrdTreeLinks(normalized)
}


export function normalizePrdTree(value: PrdTree): PrdTree {
  return rebuildPrdTreeLinks(Object.fromEntries(
    Object.entries(value).map(([id, node]) => [id, normalizePrdTreeNode(node)])
  ) as PrdTree)
}
