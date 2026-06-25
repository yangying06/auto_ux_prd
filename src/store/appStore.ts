import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultSettings } from '../data/defaultSettings'
import { removeLatestUserTurn } from '../lib/chatRecall'
import { persistableMessage, persistableNodeChats } from '../lib/messagePersistence'
import { normalizePerformanceSpec } from '../lib/performanceOrchestration'
import { defaultAudienceForSpecLens, normalizeLegacyAudience, normalizeNodeLensFields, specLensFromLegacyAudience } from '../lib/prdNodeLens'
import type { AppSettings, ChatMessage, RagSearchResult } from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'
import type { CreatePageNodeInput, DecompositionStatus, DecompositionStep, MapAdjustmentOperation, PrdNode, PrdNodeBackendContractRef, PrdNodeDocumentField, PrdNodeDocumentSnapshot, PrdNodeEvidenceRef, PrdNodeOperationSuggestion, PrdNodePolishRevision, PrdNodeReference, PrdNodeSectionKey, PrdPerformanceSpec, PrdTree, UpdateNodePatch } from '../types/prdNode'
import type { PrototypeVariant } from '../types/prototypeVariant'
import type { PrototypeSpec, PrototypeSpecMode } from '../types/prototypeSpec'
import type { ProjectSourceDocument, ProjectWorkspaceSnapshot } from '../types/archive'
import { defaultProjectWorkflow, type ProjectIterationContext, type ProjectWorkflowMode, type ProjectWorkflowState } from '../types/projectWorkflow'
import type { QaAttachment, QaIssue, QaIssuePatch, QaIssueStatus, QaNodeRef } from '../types/qa'
import { emptyAssetWorkbench, type AssetWorkbenchState, type AudioAssetRow, type EffectAssetRow, type UiAssetRow } from '../types/assetWorkbench'
import type { ReusableLogicAsset } from '../types/reusableLogic'

const emptyRequirement: UXRequirementState = {
  trigger_condition: null,
  sequence_rules: null,
  asset_dependencies: [],
  engine_constraints: null,
  ui_components: [],
  suggested_answers: [],
  completion_rate: 0,
  slot_confidence: { trigger_condition: 0, sequence_rules: 0, asset_dependencies: 0, engine_constraints: 0 },
  missing_reasons: { trigger_condition: null, sequence_rules: null, asset_dependencies: null, engine_constraints: null },
  next_question: null,
}

const STORAGE_KEY = 'gameux-promptforge-state'
const STORAGE_VERSION = 17
const PROTOTYPE_HISTORY_LIMIT = 4
const PRD_SECTION_KEYS = ['data', 'interaction', 'view'] as const satisfies readonly PrdNodeSectionKey[]

export interface PrototypeVersion {
  id: string
  label: string
  html: string
  createdAt: string
  mode: 'create' | 'update' | 'restore'
  note: string | null
  prototypeSpec?: PrototypeSpec | null
}

export interface NodePrototypeState {
  prototypeHtml: string | null
  prototypeHistory: PrototypeVersion[]
  prototypeVariants: PrototypeVariant[]
  selectedVariantIndex: number
  draftPrototypeSpec: PrototypeSpec | null
  standardPrototypeSpec: PrototypeSpec | null
}

interface PrototypeVersionMeta {
  mode?: PrototypeVersion['mode']
  note?: string | null
  prototypeSpec?: PrototypeSpec | null
}

interface NodePolishPatch {
  summary?: string | null
  content?: string | null
  techNotes?: string | null
  sections?: PrdNode['sections']
  handoffGoal?: string | null
  qualityGate?: string | null
  backendContracts?: PrdNodeBackendContractRef[]
  evidenceRefs?: PrdNode['evidenceRefs']
  performanceSpec?: PrdPerformanceSpec | null
}

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

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function createDocumentSnapshot(node: PrdNode): PrdNodeDocumentSnapshot {
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

function changedDocumentFields(before: PrdNodeDocumentSnapshot, after: PrdNodeDocumentSnapshot): PrdNodeDocumentField[] {
  return DOCUMENT_FIELDS.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
}

function createNodePolishRevision(nodeId: string, before: PrdNodeDocumentSnapshot, after: PrdNodeDocumentSnapshot): PrdNodePolishRevision | null {
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

function normalizeReferences(value: PrdNodeReference[] | null | undefined): PrdNodeReference[] {
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

function normalizeBackendContracts(value: PrdNodeBackendContractRef[] | null | undefined): PrdNodeBackendContractRef[] | undefined {
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

function evidenceRefKey(ref: PrdNodeEvidenceRef) {
  return `${ref.sourceKind}:${ref.sourceLabel}:${ref.quote ?? ''}`
}

function uniqueEvidenceRefs(refs: PrdNodeEvidenceRef[]) {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = evidenceRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeOpenQuestions(value: string[] | null | undefined) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

function mergePolishSections(
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

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>
}

function hasMeaningfulText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

function repairNodeFromRevision(node: Partial<PrdNode>, revision: PrdNodePolishRevision | undefined): Partial<PrdNode> {
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

function makePageNodeId(tree: PrdTree | null, title: string) {
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

function collectDescendantIds(tree: PrdTree, nodeId: string) {
  const ids = new Set<string>()
  const visit = (id: string) => {
    if (ids.has(id)) return
    ids.add(id)
    for (const childId of tree[id]?.children ?? []) visit(childId)
  }
  visit(nodeId)
  return ids
}

function sanitizePatch(patch: UpdateNodePatch): UpdateNodePatch {
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
  }
}

function appendAdjustmentBlock(existing: string | null | undefined, addition: string | null | undefined, heading: string) {
  const current = normalizeOptionalText(existing) ?? ''
  const next = normalizeOptionalText(addition)
  if (!next) return current
  if (current.includes(next)) return current
  const block = `## ${heading}\n\n${next}`
  return current ? `${current.trim()}\n\n${block}` : next
}

function mergeSectionAdjustment(
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

function mergeBackendContractAdjustment(
  current: PrdNodeBackendContractRef[] | undefined,
  patch: PrdNodeBackendContractRef[] | undefined,
) {
  const normalizedPatch = normalizeBackendContracts(patch)
  if (!normalizedPatch?.length) return current
  return [...(current ?? []), ...normalizedPatch]
}

function mergeMapAdjustmentPatch(node: PrdNode, patch: UpdateNodePatch): PrdNode {
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
  })
}

function makeSuggestionNodeId(tree: PrdTree, suggestion: PrdNodeOperationSuggestion) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function emptyProjectWorkflowState(): ProjectWorkflowState {
  return { mode: defaultProjectWorkflow.mode, iteration: null }
}

function normalizeWorkflowStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function normalizeProjectWorkflow(value: unknown): ProjectWorkflowState {
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

function persistedTreeHasLocalTemplates(value: unknown) {
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

function rebuildPrdTreeLinks(tree: PrdTree): PrdTree {
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

function normalizePrdTreeNode(node: PrdNode): PrdNode {
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
  })
}

function normalizePersistedPrdTree(value: unknown, revisions?: unknown): PrdTree | null {
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

function normalizePrdTree(value: PrdTree): PrdTree {
  return rebuildPrdTreeLinks(Object.fromEntries(
    Object.entries(value).map(([id, node]) => [id, normalizePrdTreeNode(node)])
  ) as PrdTree)
}

export const initialMessages: ChatMessage[] = [
  {
    role: 'assistant',
    content: '你好！我是你的 UX 需求打磨助手。请描述你想实现的交互效果，我会帮你梳理触发条件、执行规则和资源依赖。',
  },
]

export const initialMapAdjustmentMessages: ChatMessage[] = [
  {
    role: 'assistant',
    content: '如果页面拆分不合理，可以告诉我如何调整。我会先给出操作建议，确认后才会修改导图。',
  },
]

function makePrototypeVersion(
  html: string,
  history: PrototypeVersion[],
  meta: PrototypeVersionMeta | undefined,
): PrototypeVersion {
  return {
    id: `${Date.now()}-${history.length}`,
    label: `V${history.length + 1}`,
    html,
    createdAt: new Date().toISOString(),
    mode: meta?.mode ?? (history.length === 0 ? 'create' : 'update'),
    note: meta?.note?.trim() || null,
    prototypeSpec: meta?.prototypeSpec ?? null,
  }
}

function emptyNodePrototypeState(): NodePrototypeState {
  return {
    prototypeHtml: null,
    prototypeHistory: [],
    prototypeVariants: [],
    selectedVariantIndex: -1,
    draftPrototypeSpec: null,
    standardPrototypeSpec: null,
  }
}

function getNodePrototypeState(state: AppStoreState, nodeId: string): NodePrototypeState {
  return normalizeNodePrototypeState(state.nodePrototypeStates[nodeId])
}

function setNodePrototypeState(state: AppStoreState, nodeId: string, nodeState: NodePrototypeState) {
  return {
    nodePrototypeStates: {
      ...state.nodePrototypeStates,
      [nodeId]: nodeState,
    },
  }
}

function makeQaIssueId() {
  return `QA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function createQaNodeRef(node: PrdNode): QaNodeRef {
  return {
    nodeId: node.id,
    nodeType: node.type,
    title: node.label,
    summary: node.summary,
    content: node.content,
    docPath: node.docPath ?? null,
    capturedAt: new Date().toISOString(),
    snapshot: {
      id: node.id,
      label: node.label,
      summary: node.summary,
      content: node.content,
      type: node.type,
      status: node.status,
      techNotes: node.techNotes,
      docPath: node.docPath,
      audience: node.audience,
      specLens: node.specLens,
      sections: node.sections,
      handoffGoal: node.handoffGoal,
      qualityGate: node.qualityGate,
      backendContracts: node.backendContracts,
      evidenceRefs: node.evidenceRefs,
      performanceSpec: node.performanceSpec,
    },
  }
}

function createEmptyQaIssue(nodeRefs: QaNodeRef[]): QaIssue {
  const now = new Date().toISOString()
  const primaryTitle = nodeRefs[0]?.title
  return {
    id: makeQaIssueId(),
    title: primaryTitle ? `${primaryTitle} 的待确认缺陷` : '待确认缺陷',
    status: 'draft',
    severity: 'major',
    priority: 'medium',
    nodeRefs,
    attachments: [],
    messages: [
      {
        role: 'assistant',
        content: primaryTitle
          ? `已引用「${primaryTitle}」。请描述你看到的问题和复现路径，我会确认信息是否足够报给程序。`
          : '请先添加界面节点，再描述你看到的问题和复现路径。我会确认信息是否足够报给程序。',
      },
    ],
    description: '',
    stepsToReproduce: [],
    expectedResult: '',
    actualResult: '',
    environment: null,
    aiSummary: '',
    aiQuestions: [],
    aiConfidence: 0,
    suspectedCause: null,
    devSuggestion: null,
    readyToConfirm: false,
    createdAt: now,
    updatedAt: now,
    qaConfirmedAt: null,
    devReceivedAt: null,
    closedAt: null,
  }
}

function normalizeStringArray(value: string[] | undefined) {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => item.trim()).filter(Boolean)
}

function clampQaConfidence(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

function applyQaPatch(issue: QaIssue, patch: QaIssuePatch): QaIssue {
  const stepsToReproduce = normalizeStringArray(patch.stepsToReproduce)
  const aiQuestions = normalizeStringArray(patch.aiQuestions)
  return {
    ...issue,
    title: patch.title?.trim() || issue.title,
    severity: patch.severity ?? issue.severity,
    priority: patch.priority ?? issue.priority,
    description: patch.description?.trim() ?? issue.description,
    stepsToReproduce: stepsToReproduce ?? issue.stepsToReproduce,
    expectedResult: patch.expectedResult?.trim() ?? issue.expectedResult,
    actualResult: patch.actualResult?.trim() ?? issue.actualResult,
    environment: patch.environment === undefined ? issue.environment : normalizeOptionalText(patch.environment),
    aiSummary: patch.aiSummary?.trim() ?? issue.aiSummary,
    aiQuestions: aiQuestions ?? issue.aiQuestions,
    aiConfidence: clampQaConfidence(patch.aiConfidence, issue.aiConfidence),
    suspectedCause: patch.suspectedCause === undefined ? issue.suspectedCause : normalizeOptionalText(patch.suspectedCause),
    devSuggestion: patch.devSuggestion === undefined ? issue.devSuggestion : normalizeOptionalText(patch.devSuggestion),
    readyToConfirm: patch.readyToConfirm ?? issue.readyToConfirm,
    updatedAt: new Date().toISOString(),
  }
}

function issueWithStatus(issue: QaIssue, status: QaIssueStatus): QaIssue {
  const now = new Date().toISOString()
  return {
    ...issue,
    status,
    qaConfirmedAt: status === 'qa_confirmed' && !issue.qaConfirmedAt ? now : issue.qaConfirmedAt,
    devReceivedAt: status === 'dev_received' && !issue.devReceivedAt ? now : issue.devReceivedAt,
    closedAt: status === 'closed' ? now : status === 'reopened' ? null : issue.closedAt,
    updatedAt: now,
  }
}

function emptyAssetWorkbenchState(): AssetWorkbenchState {
  return {
    uiRows: [],
    effectRows: [],
    audioRows: [],
    reusableLogicAssets: [],
    lastEffectScanRoot: null,
    lastAudioScanRoot: null,
  }
}

function withPrototypeSpec(nodeState: NodePrototypeState, spec: PrototypeSpec | null | undefined): NodePrototypeState {
  if (!spec) return nodeState
  return spec.mode === 'standard'
    ? { ...nodeState, standardPrototypeSpec: spec }
    : { ...nodeState, draftPrototypeSpec: spec }
}

function normalizePrototypeVersion(value: PrototypeVersion): PrototypeVersion {
  return {
    ...value,
    prototypeSpec: value.prototypeSpec ?? null,
  }
}

function normalizeNodePrototypeState(value: NodePrototypeState | undefined | null): NodePrototypeState {
  if (!value) return emptyNodePrototypeState()
  return {
    prototypeHtml: typeof value.prototypeHtml === 'string' ? value.prototypeHtml : null,
    prototypeHistory: Array.isArray(value.prototypeHistory) ? value.prototypeHistory.map(normalizePrototypeVersion).slice(0, PROTOTYPE_HISTORY_LIMIT) : [],
    prototypeVariants: Array.isArray(value.prototypeVariants)
      ? value.prototypeVariants.map((variant) => ({ ...variant, prototypeSpec: variant.prototypeSpec ?? null }))
      : [],
    selectedVariantIndex: typeof value.selectedVariantIndex === 'number' ? value.selectedVariantIndex : -1,
    draftPrototypeSpec: value.draftPrototypeSpec ?? null,
    standardPrototypeSpec: value.standardPrototypeSpec ?? null,
  }
}

function normalizeNodePrototypeStates(value: unknown): Record<string, NodePrototypeState> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, NodePrototypeState>).map(([nodeId, nodeState]) => [
      nodeId,
      normalizeNodePrototypeState(nodeState),
    ]),
  )
}

function normalizeUiAssetKind(rowOrKind: unknown) {
  const rawKind = isRecord(rowOrKind) ? rowOrKind.kind : rowOrKind
  const rawParseMode = isRecord(rowOrKind) ? rowOrKind.parseMode : undefined
  const rawResult = isRecord(rowOrKind) ? rowOrKind.result : undefined
  const rawResultParseMode = isRecord(rawResult) ? rawResult.parseMode : undefined
  const kindText = String(rawKind ?? '').trim().toLowerCase()

  if (
    kindText === 'image_set'
    || kindText === 'component'
    || kindText === 'image'
    || kindText === 'images'
    || kindText === 'image-set'
    || kindText === '散图'
  ) {
    return 'image_set'
  }

  if (rawParseMode === 'image_set' || rawResultParseMode === 'image_set') {
    return 'image_set'
  }

  return 'interface'
}

function normalizeUiAssetParseMode(value: unknown, kind: ReturnType<typeof normalizeUiAssetKind>) {
  if (kind === 'image_set') return 'image_set'
  return value === 'image_set' ? 'image_set' : 'intermediate'
}

function normalizeEffectLoadStatus(value: unknown) {
  return value === 'loading' || value === 'loaded' || value === 'error' ? value : 'not_loaded'
}

function normalizeAudioLoadStatus(value: unknown) {
  return value === 'loading' || value === 'loaded' || value === 'error' ? value : 'not_loaded'
}

function normalizeStringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function normalizeEffectSpineAsset(value: unknown): EffectAssetRow['spine'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as NonNullable<EffectAssetRow['spine']>
  const atlasUrl = typeof raw.atlasUrl === 'string' && raw.atlasUrl.trim() ? raw.atlasUrl : null
  const textureUrls = normalizeStringArrayValue(raw.textureUrls)
  if (!atlasUrl || textureUrls.length === 0) return null
  return {
    jsonUrl: typeof raw.jsonUrl === 'string' && raw.jsonUrl.trim() ? raw.jsonUrl : null,
    binaryUrl: typeof raw.binaryUrl === 'string' && raw.binaryUrl.trim() ? raw.binaryUrl : null,
    atlasUrl,
    textureUrls,
    animationNames: normalizeStringArrayValue(raw.animationNames),
    skinNames: normalizeStringArrayValue(raw.skinNames),
    defaultAnimation: typeof raw.defaultAnimation === 'string' && raw.defaultAnimation.trim() ? raw.defaultAnimation : null,
    skeletonVersion: typeof raw.skeletonVersion === 'string' && raw.skeletonVersion.trim() ? raw.skeletonVersion : null,
    premultipliedAlpha: typeof raw.premultipliedAlpha === 'boolean' ? raw.premultipliedAlpha : null,
    playerJsUrl: typeof raw.playerJsUrl === 'string' && raw.playerJsUrl.trim() ? raw.playerJsUrl : null,
    playerCssUrl: typeof raw.playerCssUrl === 'string' && raw.playerCssUrl.trim() ? raw.playerCssUrl : null,
  }
}

function normalizeReusableLogicStatus(value: unknown): ReusableLogicAsset['status'] {
  return value === 'approved' || value === 'ignored' ? value : 'candidate'
}

function normalizeReusableLogicType(value: unknown): ReusableLogicAsset['type'] {
  if (
    value === 'interaction_state'
    || value === 'animation_rule'
    || value === 'feedback_pattern'
    || value === 'component_pattern'
    || value === 'copywriting_pattern'
  ) {
    return value
  }
  return 'interaction_state'
}

function normalizeReusableLogicAssets(value: unknown): ReusableLogicAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ReusableLogicAsset[] => {
    if (!isRecord(item)) return []
    const id = normalizeOptionalText(item.id)
    const name = normalizeOptionalText(item.name)
    const logic = normalizeOptionalText(item.logic)
    const source = isRecord(item.source) ? item.source : {}
    const sourceNodeId = normalizeOptionalText(source.nodeId)
    const sourceNodeLabel = normalizeOptionalText(source.nodeLabel)
    if (!id || !name || !logic || !sourceNodeId || !sourceNodeLabel) return []
    const now = new Date().toISOString()
    return [{
      id,
      name,
      type: normalizeReusableLogicType(item.type),
      status: normalizeReusableLogicStatus(item.status),
      reuseMode: item.reuseMode === 'copy' ? 'copy' : 'reference',
      description: normalizeOptionalText(item.description) ?? logic,
      logic,
      usageGuidance: normalizeOptionalText(item.usageGuidance) ?? '复用前确认当前节点资源、层级和结束状态是否匹配。',
      tags: Array.isArray(item.tags)
        ? item.tags.map((tag) => normalizeOptionalText(tag)).filter((tag): tag is string => Boolean(tag)).slice(0, 10)
        : [],
      source: {
        nodeId: sourceNodeId,
        nodeLabel: sourceNodeLabel,
        field: normalizeOptionalText(source.field) ?? 'performanceSpec',
        excerpt: normalizeOptionalText(source.excerpt),
      },
      createdAt: normalizeOptionalText(item.createdAt) ?? now,
      updatedAt: normalizeOptionalText(item.updatedAt) ?? now,
    }]
  })
}

function normalizeAudioAssetKind(value: unknown): AudioAssetRow['kind'] {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'sfx' || text === 'effect' || text === 'sound_effect') return 'sfx'
  if (text === 'music' || text === 'bgm') return 'music'
  if (text === 'voice' || text === 'vo') return 'voice'
  if (text === 'ambient' || text === 'ambience') return 'ambient'
  return 'unknown'
}

function normalizeAudioAssetRow(row: Partial<AudioAssetRow> & Record<string, unknown>): AudioAssetRow {
  const now = new Date().toISOString()
  const files = Array.isArray(row.files)
    ? row.files.map((file) => ({
        ...(file as AudioAssetRow['files'][number]),
        loadedPath: typeof (file as { loadedPath?: unknown }).loadedPath === 'string' ? (file as { loadedPath: string }).loadedPath : null,
        previewUrl: typeof (file as { previewUrl?: unknown }).previewUrl === 'string' ? (file as { previewUrl: string }).previewUrl : null,
      }))
    : []
  return {
    id: normalizeOptionalText(row.id) ?? `audio-${now}`,
    name: normalizeOptionalText(row.name) ?? 'Audio asset',
    kind: normalizeAudioAssetKind(row.kind),
    sourceRoot: normalizeOptionalText(row.sourceRoot) ?? '',
    relativePath: normalizeOptionalText(row.relativePath) ?? '',
    localPath: normalizeOptionalText(row.localPath) ?? normalizeOptionalText(row.sourceRoot) ?? '',
    purpose: normalizeOptionalText(row.purpose) ?? '',
    usageNote: normalizeOptionalText(row.usageNote) ?? '',
    triggerHint: normalizeOptionalText(row.triggerHint) ?? normalizeOptionalText((row as { pageHint?: unknown }).pageHint) ?? '',
    playbackHint: normalizeOptionalText(row.playbackHint) ?? normalizeOptionalText((row as { implementationHint?: unknown }).implementationHint) ?? '',
    linkedNodeIds: Array.isArray(row.linkedNodeIds) ? row.linkedNodeIds.filter((id): id is string => typeof id === 'string') : [],
    status: row.status === 'parsing' || row.status === 'error' || row.status === 'idle' ? row.status : 'ready',
    loadStatus: normalizeAudioLoadStatus(row.loadStatus),
    loadError: typeof row.loadError === 'string' ? row.loadError : null,
    loadedRoot: typeof row.loadedRoot === 'string' ? row.loadedRoot : null,
    loadedPath: typeof row.loadedPath === 'string' ? row.loadedPath : null,
    loadedFileCount: typeof row.loadedFileCount === 'number' ? row.loadedFileCount : 0,
    loadedBytes: typeof row.loadedBytes === 'number' ? row.loadedBytes : 0,
    loadedAt: typeof row.loadedAt === 'string' ? row.loadedAt : null,
    previewUrl: typeof row.previewUrl === 'string' ? row.previewUrl : null,
    durationMs: typeof row.durationMs === 'number' ? row.durationMs : null,
    fileCount: typeof row.fileCount === 'number' ? row.fileCount : files.length,
    files,
    createdAt: normalizeOptionalText(row.createdAt) ?? now,
    updatedAt: normalizeOptionalText(row.updatedAt) ?? now,
  }
}

function audioRowFromLegacyEffectRow(row: EffectAssetRow): AudioAssetRow {
  return normalizeAudioAssetRow({
    ...row,
    id: row.id.replace(/^effect-/u, 'audio-'),
    kind: 'sfx',
    triggerHint: row.pageHint,
    playbackHint: row.implementationHint,
  })
}

function normalizeAssetWorkbench(value: AssetWorkbenchState | null | undefined): AssetWorkbenchState {
  if (!value || typeof value !== 'object') return emptyAssetWorkbenchState()
  const legacyAudioRows = Array.isArray(value.effectRows)
    ? value.effectRows
        .filter((row) => (row as { kind?: unknown }).kind === 'audio')
        .map((row) => audioRowFromLegacyEffectRow(row as EffectAssetRow))
    : []
  const audioRows = [
    ...(Array.isArray((value as { audioRows?: unknown }).audioRows)
      ? (value as unknown as { audioRows: Array<Partial<AudioAssetRow> & Record<string, unknown>> }).audioRows.map(normalizeAudioAssetRow)
      : []),
    ...legacyAudioRows,
  ]
  return {
    uiRows: Array.isArray(value.uiRows)
      ? value.uiRows.map((row) => {
          const kind = normalizeUiAssetKind(row)
          return {
            ...row,
            kind,
            parseMode: normalizeUiAssetParseMode((row as { parseMode?: unknown }).parseMode, kind),
          }
        })
      : [],
    effectRows: Array.isArray(value.effectRows)
      ? value.effectRows.filter((row) => (row as { kind?: unknown }).kind !== 'audio').map((row) => ({
          ...row,
          loadStatus: normalizeEffectLoadStatus((row as { loadStatus?: unknown }).loadStatus),
          loadError: typeof (row as { loadError?: unknown }).loadError === 'string' ? (row as { loadError: string }).loadError : null,
          loadedRoot: typeof (row as { loadedRoot?: unknown }).loadedRoot === 'string' ? (row as { loadedRoot: string }).loadedRoot : null,
          loadedPath: typeof (row as { loadedPath?: unknown }).loadedPath === 'string' ? (row as { loadedPath: string }).loadedPath : null,
          loadedFileCount: typeof (row as { loadedFileCount?: unknown }).loadedFileCount === 'number' ? (row as { loadedFileCount: number }).loadedFileCount : 0,
          loadedBytes: typeof (row as { loadedBytes?: unknown }).loadedBytes === 'number' ? (row as { loadedBytes: number }).loadedBytes : 0,
          loadedAt: typeof (row as { loadedAt?: unknown }).loadedAt === 'string' ? (row as { loadedAt: string }).loadedAt : null,
          previewType: ['image', 'sequence', 'video', 'audio', 'spine'].includes(String((row as { previewType?: unknown }).previewType))
            ? (row as { previewType: EffectAssetRow['previewType'] }).previewType
            : null,
          previewUrl: typeof (row as { previewUrl?: unknown }).previewUrl === 'string' ? (row as { previewUrl: string }).previewUrl : null,
          previewFiles: Array.isArray((row as { previewFiles?: unknown }).previewFiles)
            ? (row as { previewFiles: EffectAssetRow['previewFiles'] }).previewFiles.filter((file) => (
                file && typeof file.name === 'string' && typeof file.ext === 'string' && typeof file.url === 'string'
              ))
            : [],
          spine: normalizeEffectSpineAsset((row as { spine?: unknown }).spine),
          files: Array.isArray(row.files)
            ? row.files.map((file) => ({
                ...file,
                loadedPath: typeof (file as { loadedPath?: unknown }).loadedPath === 'string' ? (file as { loadedPath: string }).loadedPath : null,
                previewUrl: typeof (file as { previewUrl?: unknown }).previewUrl === 'string' ? (file as { previewUrl: string }).previewUrl : null,
              }))
            : [],
        }))
      : [],
    audioRows,
    reusableLogicAssets: normalizeReusableLogicAssets((value as { reusableLogicAssets?: unknown }).reusableLogicAssets),
    lastEffectScanRoot: typeof value.lastEffectScanRoot === 'string' ? value.lastEffectScanRoot : null,
    lastAudioScanRoot: typeof (value as { lastAudioScanRoot?: unknown }).lastAudioScanRoot === 'string' ? (value as { lastAudioScanRoot: string }).lastAudioScanRoot : null,
  }
}

function mergeEffectAssetScanRows(existingRows: EffectAssetRow[], sourceRoot: string, scannedRows: EffectAssetRow[]) {
  const existingById = new Map(existingRows.filter((row) => row.sourceRoot === sourceRoot).map((row) => [row.id, row]))
  const mergedRows = scannedRows.map((row) => {
    const existing = existingById.get(row.id)
    if (!existing) return row
    const loadedPathBySourcePath = new Map(existing.files.map((file) => [file.path, file.loadedPath ?? null]))
    const scannedNote = row.usageNote.trim()
    return {
      ...row,
      name: existing.name,
      purpose: scannedNote ? '' : existing.purpose,
      usageNote: scannedNote || existing.usageNote,
      pageHint: scannedNote ? '' : existing.pageHint,
      implementationHint: scannedNote ? '' : existing.implementationHint,
      linkedNodeIds: existing.linkedNodeIds,
      loadStatus: existing.loadStatus,
      loadError: existing.loadError,
      loadedRoot: existing.loadedRoot,
      loadedPath: existing.loadedPath,
      loadedFileCount: existing.loadedFileCount,
      loadedBytes: existing.loadedBytes,
      loadedAt: existing.loadedAt,
      previewType: existing.previewType,
      previewUrl: existing.previewUrl,
      previewFiles: existing.previewFiles,
      spine: existing.spine,
      files: row.files.map((file) => ({
        ...file,
        loadedPath: loadedPathBySourcePath.get(file.path) ?? null,
        previewUrl: existing.files.find((existingFile) => existingFile.path === file.path)?.previewUrl ?? null,
      })),
      createdAt: existing.createdAt,
      updatedAt: row.updatedAt,
    }
  })
  return [
    ...mergedRows,
    ...existingRows.filter((row) => row.sourceRoot !== sourceRoot),
  ]
}

function mergeAudioAssetScanRows(existingRows: AudioAssetRow[], sourceRoot: string, scannedRows: AudioAssetRow[]) {
  const existingById = new Map(existingRows.filter((row) => row.sourceRoot === sourceRoot).map((row) => [row.id, row]))
  const mergedRows = scannedRows.map((row) => {
    const existing = existingById.get(row.id)
    if (!existing) return row
    const loadedPathBySourcePath = new Map(existing.files.map((file) => [file.path, file.loadedPath ?? null]))
    return {
      ...row,
      name: existing.name,
      kind: existing.kind,
      purpose: existing.purpose,
      usageNote: existing.usageNote || row.usageNote,
      triggerHint: existing.triggerHint || row.triggerHint,
      playbackHint: existing.playbackHint || row.playbackHint,
      linkedNodeIds: existing.linkedNodeIds,
      loadStatus: existing.loadStatus,
      loadError: existing.loadError,
      loadedRoot: existing.loadedRoot,
      loadedPath: existing.loadedPath,
      loadedFileCount: existing.loadedFileCount,
      loadedBytes: existing.loadedBytes,
      loadedAt: existing.loadedAt,
      previewUrl: existing.previewUrl,
      durationMs: existing.durationMs,
      files: row.files.map((file) => ({
        ...file,
        loadedPath: loadedPathBySourcePath.get(file.path) ?? null,
        previewUrl: existing.files.find((existingFile) => existingFile.path === file.path)?.previewUrl ?? null,
      })),
      createdAt: existing.createdAt,
      updatedAt: row.updatedAt,
    }
  })
  return [
    ...mergedRows,
    ...existingRows.filter((row) => row.sourceRoot !== sourceRoot),
  ]
}

export interface AppStoreState {
  requirement: UXRequirementState
  messages: ChatMessage[]
  latestRag: RagSearchResult | null
  prototypeHtml: string | null
  prototypeHistory: PrototypeVersion[]
  prototypeVariants: PrototypeVariant[]
  selectedVariantIndex: number
  nodePrototypeStates: Record<string, NodePrototypeState>
  settings: AppSettings
  prdTree: PrdTree | null
  selectedNodeId: string | null
  decompositionStatus: DecompositionStatus
  decompositionSteps: DecompositionStep[]
  nodeChats: Record<string, ChatMessage[]>
  nodePolishRevisions: Record<string, PrdNodePolishRevision>
  nodeOperationSuggestions: Record<string, PrdNodeOperationSuggestion[]>
  qaIssues: Record<string, QaIssue>
  mapAdjustmentMessages: ChatMessage[]
  pendingMapAdjustmentOperations: MapAdjustmentOperation[]
  assetWorkbench: AssetWorkbenchState
  sourceDocument: ProjectSourceDocument | null
  projectWorkflow: ProjectWorkflowState
  currentArchivePath: string | null
  lastSavedAt: string | null
  archiveDirty: boolean
  setSourceDocument: (sourceDocument: ProjectSourceDocument | null) => void
  setProjectWorkflowMode: (mode: ProjectWorkflowMode) => void
  setProjectIterationContext: (context: ProjectIterationContext | null) => void
  loadArchiveSnapshot: (snapshot: ProjectWorkspaceSnapshot, archivePath: string | null, savedAt?: string | null) => void
  markArchiveSaved: (archivePath: string | null, savedAt?: string) => void
  markArchiveDirty: () => void
  resetProject: () => void
  createPageNode: (input: CreatePageNodeInput) => string
  updateNode: (nodeId: string, patch: UpdateNodePatch) => void
  updateNodeContent: (nodeId: string, content: string) => void
  deleteNode: (nodeId: string) => void
  applyMapAdjustmentOperations: (operations: MapAdjustmentOperation[]) => void
  setNodeDocPath: (nodeId: string, docPath: string | null) => void
  appendNodeMessage: (nodeId: string, msg: ChatMessage) => void
  removeLastNodeChatTurn: (nodeId: string) => ChatMessage | null
  clearNodeChat: (nodeId: string) => void
  setNodeOperationSuggestions: (scopeId: string, suggestions: PrdNodeOperationSuggestion[]) => void
  dismissNodeOperationSuggestion: (scopeId: string, suggestionId: string) => void
  applyNodeOperationSuggestion: (scopeId: string, suggestionId: string) => void
  createQaIssue: (initialNodeId?: string | null) => string
  deleteQaIssue: (issueId: string) => void
  appendQaIssueMessage: (issueId: string, message: ChatMessage) => void
  removeLastQaIssueTurn: (issueId: string) => ChatMessage | null
  applyQaIssuePatch: (issueId: string, patch: QaIssuePatch) => void
  addQaIssueNodeRef: (issueId: string, nodeId: string) => void
  removeQaIssueNodeRef: (issueId: string, nodeId: string) => void
  addQaIssueAttachment: (issueId: string, attachment: QaAttachment) => void
  removeQaIssueAttachment: (issueId: string, attachmentId: string) => void
  updateQaIssueStatus: (issueId: string, status: QaIssueStatus) => void
  setMapAdjustmentMessages: (messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void
  removeLastMapAdjustmentTurn: () => ChatMessage | null
  setPendingMapAdjustmentOperations: (operations: MapAdjustmentOperation[]) => void
  clearMapAdjustmentState: () => void
  setAssetWorkbench: (assetWorkbench: AssetWorkbenchState) => void
  addUiAssetRow: (row: UiAssetRow) => void
  updateUiAssetRow: (rowId: string, patch: Partial<UiAssetRow>) => void
  removeUiAssetRow: (rowId: string) => void
  replaceEffectAssetRows: (sourceRoot: string, rows: EffectAssetRow[]) => void
  updateEffectAssetRow: (rowId: string, patch: Partial<EffectAssetRow>) => void
  removeEffectAssetRow: (rowId: string) => void
  replaceAudioAssetRows: (sourceRoot: string, rows: AudioAssetRow[]) => void
  updateAudioAssetRow: (rowId: string, patch: Partial<AudioAssetRow>) => void
  removeAudioAssetRow: (rowId: string) => void
  upsertReusableLogicAssets: (assets: ReusableLogicAsset[]) => void
  updateReusableLogicAsset: (assetId: string, patch: Partial<ReusableLogicAsset>) => void
  approveReusableLogicAsset: (assetId: string) => void
  ignoreReusableLogicAsset: (assetId: string) => void
  removeReusableLogicAsset: (assetId: string) => void
  clearAssetWorkbench: () => void
  applyNodePolish: (nodeId: string, patch: NodePolishPatch) => void
  acceptNodePolishRevision: (nodeId: string) => void
  revertNodePolishRevision: (nodeId: string) => void
  updateNodeStatus: (nodeId: string, status: PrdNode['status']) => void
  applyRequirementPatch: (patch: Partial<UXRequirementState>) => void
  setMessages: (messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void
  setLatestRag: (rag: RagSearchResult | null) => void
  setPrototypeHtml: (html: string | null, meta?: PrototypeVersionMeta) => void
  recordPrototypeHistory: (html: string, meta?: PrototypeVersionMeta) => void
  restorePrototypeVersion: (id: string) => void
  clearPrototypeHistory: () => void
  setPrototypeVariants: (variants: PrototypeVariant[]) => void
  updatePrototypeVariant: (index: number, patch: Partial<PrototypeVariant>) => void
  selectPrototypeVariant: (index: number) => void
  clearPrototypeVariants: () => void
  setNodePrototypeHtml: (nodeId: string, html: string | null, meta?: PrototypeVersionMeta) => void
  recordNodePrototypeHistory: (nodeId: string, html: string, meta?: PrototypeVersionMeta) => void
  restoreNodePrototypeVersion: (nodeId: string, id: string) => void
  clearNodePrototypeHistory: (nodeId: string) => void
  setNodePrototypeSpec: (nodeId: string, mode: PrototypeSpecMode, spec: PrototypeSpec | null) => void
  setNodePrototypeVariants: (nodeId: string, variants: PrototypeVariant[]) => void
  updateNodePrototypeVariant: (nodeId: string, index: number, patch: Partial<PrototypeVariant>) => void
  selectNodePrototypeVariant: (nodeId: string, index: number) => void
  clearNodePrototypeVariants: (nodeId: string) => void
  updateSettings: (settings: AppSettings) => void
  resetSession: () => void
  resetRequirement: () => void
  setPrdTree: (tree: PrdTree) => void
  setSelectedNodeId: (id: string | null) => void
  setDecompositionStatus: (s: DecompositionStatus) => void
  appendDecompositionStep: (step: DecompositionStep) => void
  updateDecompositionStep: (index: number, update: Partial<DecompositionStep>) => void
  mergePartialTree: (nodes: Record<string, PrdNode>) => void
  resetDecomposition: () => void
}

export const useAppStore = create<AppStoreState>()(
  persist(
    (set) => ({
      requirement: emptyRequirement,
      messages: initialMessages,
      latestRag: null,
      prototypeHtml: null,
      prototypeHistory: [],
      prototypeVariants: [],
      selectedVariantIndex: -1,
      nodePrototypeStates: {},
      settings: defaultSettings,
      prdTree: null,
      selectedNodeId: null,
      decompositionStatus: 'idle',
      decompositionSteps: [],
      nodeChats: {},
      nodePolishRevisions: {},
      nodeOperationSuggestions: {},
      qaIssues: {},
      mapAdjustmentMessages: initialMapAdjustmentMessages,
      pendingMapAdjustmentOperations: [],
      assetWorkbench: emptyAssetWorkbench,
      sourceDocument: null,
      projectWorkflow: emptyProjectWorkflowState(),
      currentArchivePath: null,
      lastSavedAt: null,
      archiveDirty: false,
      setSourceDocument: (sourceDocument) => set({ sourceDocument, archiveDirty: true }),
      setProjectWorkflowMode: (mode) =>
        set((state) => ({
          projectWorkflow: mode === 'new_project'
            ? emptyProjectWorkflowState()
            : {
                mode,
                iteration: state.projectWorkflow.iteration ?? {
                  codebasePath: '',
                  focus: '',
                  baselineScan: null,
                  platformStrategyNotes: [],
                  acceptanceFocus: [],
                },
              },
          archiveDirty: true,
        })),
      setProjectIterationContext: (context) =>
        set({
          projectWorkflow: context
            ? { mode: 'existing_project_iteration', iteration: context }
            : emptyProjectWorkflowState(),
          archiveDirty: true,
        }),
      loadArchiveSnapshot: (snapshot, currentArchivePath, savedAt) =>
        set(() => {
          const prdTree = normalizePersistedPrdTree(snapshot.prdTree, snapshot.nodePolishRevisions)
          const selectedNodeId = prdTree && snapshot.selectedNodeId && prdTree[snapshot.selectedNodeId]
            ? snapshot.selectedNodeId
            : null
          return {
            requirement: snapshot.requirement ?? emptyRequirement,
            messages: snapshot.messages ?? initialMessages,
            latestRag: snapshot.latestRag ?? null,
            prototypeHtml: snapshot.prototypeHtml ?? null,
            prototypeHistory: Array.isArray(snapshot.prototypeHistory) ? snapshot.prototypeHistory.slice(0, PROTOTYPE_HISTORY_LIMIT) : [],
            prototypeVariants: Array.isArray(snapshot.prototypeVariants) ? snapshot.prototypeVariants : [],
            selectedVariantIndex: typeof snapshot.selectedVariantIndex === 'number' ? snapshot.selectedVariantIndex : -1,
            nodePrototypeStates: normalizeNodePrototypeStates(snapshot.nodePrototypeStates),
            settings: snapshot.settings ?? defaultSettings,
            prdTree,
            selectedNodeId,
            decompositionStatus: prdTree ? 'done' : 'idle',
            decompositionSteps: [],
            nodeChats: snapshot.nodeChats ?? {},
            nodePolishRevisions: snapshot.nodePolishRevisions ?? {},
            nodeOperationSuggestions: snapshot.nodeOperationSuggestions ?? {},
            qaIssues: snapshot.qaIssues ?? {},
            mapAdjustmentMessages: snapshot.mapAdjustmentMessages ?? initialMapAdjustmentMessages,
            pendingMapAdjustmentOperations: snapshot.pendingMapAdjustmentOperations ?? [],
            assetWorkbench: normalizeAssetWorkbench(snapshot.assetWorkbench),
            sourceDocument: snapshot.sourceDocument ?? null,
            projectWorkflow: normalizeProjectWorkflow(snapshot.projectWorkflow),
            currentArchivePath,
            lastSavedAt: savedAt ?? new Date().toISOString(),
            archiveDirty: false,
          }
        }),
      markArchiveSaved: (currentArchivePath, savedAt) => set({ currentArchivePath, lastSavedAt: savedAt ?? new Date().toISOString(), archiveDirty: false }),
      markArchiveDirty: () => set({ archiveDirty: true }),
      resetProject: () =>
        set({
          requirement: emptyRequirement,
          messages: initialMessages,
          latestRag: null,
          prototypeHtml: null,
          prototypeHistory: [],
          prototypeVariants: [],
          selectedVariantIndex: -1,
          nodePrototypeStates: {},
          prdTree: null,
          selectedNodeId: null,
          decompositionStatus: 'idle',
          decompositionSteps: [],
          nodeChats: {},
          nodePolishRevisions: {},
          nodeOperationSuggestions: {},
          qaIssues: {},
          mapAdjustmentMessages: initialMapAdjustmentMessages,
          pendingMapAdjustmentOperations: [],
          assetWorkbench: emptyAssetWorkbenchState(),
          sourceDocument: null,
          projectWorkflow: emptyProjectWorkflowState(),
          currentArchivePath: null,
          lastSavedAt: null,
          archiveDirty: false,
        }),
      createPageNode: (input) => {
        const title = input.title.trim()
        if (!title) return ''
        const state = useAppStore.getState()
        const tree = state.prdTree ?? {}
        const parent = input.parentId ? tree[input.parentId] : null
        const siblings = Object.values(tree).filter((node) => node.parentId === (parent?.id ?? null))
        const id = makePageNodeId(tree, title)
        const node: PrdNode = {
          id,
          parentId: parent?.id ?? null,
          label: title,
          summary: input.summary?.trim() || `${title} 页面待打磨。`,
          content: input.content?.trim() || `## 页面内容\n\n${title} 页面尚未打磨，请在右侧详情或 Deep Forge 中补齐交互规则、状态和跳转关系。`,
          type: 'page',
          status: 'pending_refine',
          level: parent ? parent.level + 1 : 1,
          order: siblings.length,
          needsPolish: true,
          extractedFrom: null,
          techNotes: null,
          children: [],
          docPath: `pages/${id}.md`,
          audience: 'client',
          specLens: 'full',
          sections: {},
          handoffGoal: `打磨 ${title} 页面的交互设计规格。`,
          qualityGate: '页面目标、入口、UI 元素、状态、跳转关系和验收点清晰。',
          references: [],
        }
        set({ prdTree: rebuildPrdTreeLinks({ ...tree, [id]: node }), selectedNodeId: id, archiveDirty: true })
        return id
      },
      updateNode: (nodeId, patch) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state
          const nextPatch = sanitizePatch(patch)
          const { sections, ...restPatch } = nextPatch
          const compactPatch = withoutUndefined(restPatch)
          return {
            prdTree: rebuildPrdTreeLinks({
              ...state.prdTree,
              [nodeId]: {
                ...node,
                ...compactPatch,
                sections: mergePolishSections(node.sections, sections),
              },
            }),
            archiveDirty: true,
          }
        }),
      updateNodeContent: (nodeId, content) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state
          return { prdTree: { ...state.prdTree, [nodeId]: { ...node, content } }, archiveDirty: true }
        }),
      deleteNode: (nodeId) =>
        set((state) => {
          if (!state.prdTree?.[nodeId]) return state
          const removedIds = collectDescendantIds(state.prdTree, nodeId)
          const next = Object.fromEntries(
            Object.entries(state.prdTree)
              .filter(([id]) => !removedIds.has(id))
              .map(([id, node]) => [id, {
                ...node,
                references: normalizeReferences(node.references).filter((reference) => !reference.targetNodeId || !removedIds.has(reference.targetNodeId)),
              }])
          ) as PrdTree
          return {
            prdTree: rebuildPrdTreeLinks(next),
            selectedNodeId: removedIds.has(state.selectedNodeId ?? '') ? null : state.selectedNodeId,
            nodePolishRevisions: Object.fromEntries(
              Object.entries(state.nodePolishRevisions).filter(([id]) => !removedIds.has(id)),
            ),
            archiveDirty: true,
          }
        }),
      applyMapAdjustmentOperations: (operations) =>
        set((state) => {
          let tree = state.prdTree ?? {}
          let selectedNodeId = state.selectedNodeId
          const removedRevisionIds = new Set<string>()
          for (const operation of operations) {
            if (operation.type === 'create_node') {
              const title = operation.title.trim()
              if (!title) continue
              const parent = operation.parentId ? tree[operation.parentId] : null
              const siblings = Object.values(tree).filter((node) => node.parentId === (parent?.id ?? null))
              const id = makePageNodeId(tree, title)
              tree = {
                ...tree,
                [id]: {
                  id,
                  parentId: parent?.id ?? null,
                  label: title,
                  summary: operation.summary?.trim() || `${title} 页面待打磨。`,
                  content: operation.content?.trim() || `## 页面内容\n\n${title} 页面尚未打磨。`,
                  type: 'page',
                  status: 'pending_refine',
                  level: parent ? parent.level + 1 : 1,
                  order: siblings.length,
                  needsPolish: true,
                  extractedFrom: null,
                  techNotes: null,
                  children: [],
                  docPath: `pages/${id}.md`,
                  audience: 'client',
                  specLens: 'full',
                  sections: {},
                  handoffGoal: `打磨 ${title} 页面的交互设计规格。`,
                  qualityGate: '页面目标、入口、UI 元素、状态、跳转关系和验收点清晰。',
                  references: [],
                },
              }
              selectedNodeId = id
            } else if (operation.type === 'delete_node') {
              // AI feedback is allowed to suggest restructuring, but it must never
              // delete existing PRD/document nodes. Users can remove nodes manually.
              continue
            } else if (operation.type === 'update_node') {
              const node = tree[operation.nodeId]
              if (!node) continue
              tree = { ...tree, [operation.nodeId]: mergeMapAdjustmentPatch(node, operation.patch) }
            } else if (operation.type === 'move_content') {
              const from = tree[operation.fromNodeId]
              const to = tree[operation.toNodeId]
              const content = operation.content.trim()
              if (!from || !to || !content) continue
              tree = {
                ...tree,
                [operation.toNodeId]: {
                  ...to,
                  content: appendAdjustmentBlock(to.content, content, `从「${from.label}」补充的反馈内容`),
                  status: to.status === 'done' ? 'done' : 'pending_refine',
                },
              }
            } else if (operation.type === 'add_reference') {
              const source = tree[operation.sourceNodeId]
              const target = tree[operation.targetNodeId]
              if (!source || !target) continue
              tree = {
                ...tree,
                [operation.sourceNodeId]: {
                  ...source,
                  references: normalizeReferences([
                    ...(source.references ?? []),
                    { targetNodeId: operation.targetNodeId, label: operation.label, reason: operation.reason ?? null, sourceNodeId: operation.sourceNodeId },
                  ]),
                },
              }
            }
          }
          return {
            prdTree: normalizePrdTree(tree),
            selectedNodeId,
            nodePolishRevisions: removedRevisionIds.size
              ? Object.fromEntries(Object.entries(state.nodePolishRevisions).filter(([id]) => !removedRevisionIds.has(id)))
              : state.nodePolishRevisions,
            archiveDirty: true,
          }
        }),
      setNodeDocPath: (nodeId, docPath) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state
          return { prdTree: { ...state.prdTree, [nodeId]: { ...node, docPath } }, archiveDirty: true }
        }),
      appendNodeMessage: (nodeId, msg) =>
        set((state) => ({
          nodeChats: {
            ...state.nodeChats,
            [nodeId]: [...(state.nodeChats[nodeId] ?? []), msg],
          },
          archiveDirty: true,
        })),
      removeLastNodeChatTurn: (nodeId) => {
        let recalledMessage: ChatMessage | null = null
        set((state) => {
          const currentMessages = state.nodeChats[nodeId] ?? []
          const result = removeLatestUserTurn(currentMessages)
          if (!result.recalledMessage) return state
          recalledMessage = result.recalledMessage
          return {
            nodeChats: {
              ...state.nodeChats,
              [nodeId]: result.messages,
            },
            nodeOperationSuggestions: {
              ...state.nodeOperationSuggestions,
              [nodeId]: [],
            },
            archiveDirty: true,
          }
        })
        return recalledMessage
      },
      clearNodeChat: (nodeId) =>
        set((state) => {
          const { [nodeId]: _, ...rest } = state.nodeChats
          return { nodeChats: rest, archiveDirty: true }
        }),
      setNodeOperationSuggestions: (scopeId, suggestions) =>
        set((state) => ({
          nodeOperationSuggestions: {
            ...state.nodeOperationSuggestions,
            [scopeId]: suggestions.map((suggestion) => ({ ...suggestion, status: 'pending' })),
          },
          archiveDirty: true,
        })),
      dismissNodeOperationSuggestion: (scopeId, suggestionId) =>
        set((state) => ({
          nodeOperationSuggestions: {
            ...state.nodeOperationSuggestions,
            [scopeId]: (state.nodeOperationSuggestions[scopeId] ?? []).filter((suggestion) => suggestion.id !== suggestionId),
          },
          archiveDirty: true,
        })),
      applyNodeOperationSuggestion: (scopeId, suggestionId) =>
        set((state) => {
          const suggestion = (state.nodeOperationSuggestions[scopeId] ?? []).find((item) => item.id === suggestionId)
          if (!suggestion || !state.prdTree) return state
          let tree = state.prdTree
          if (suggestion.operation === 'update') {
            const targetId = suggestion.targetNodeId ?? ''
            const node = tree[targetId]
            if (!node) return state
            tree = { ...tree, [targetId]: mergeMapAdjustmentPatch(node, suggestion.patch as UpdateNodePatch) }
          } else {
            const parent = suggestion.parentId ? tree[suggestion.parentId] : null
            const siblings = Object.values(tree).filter((node) => node.parentId === (parent?.id ?? null))
            const id = suggestion.targetNodeId && !tree[suggestion.targetNodeId]
              ? suggestion.targetNodeId
              : makeSuggestionNodeId(tree, suggestion)
            tree = {
              ...tree,
              [id]: {
                id,
                parentId: parent?.id ?? null,
                label: suggestion.patch.label ?? '补充节点',
                summary: suggestion.patch.summary ?? '基于补充资料生成的待打磨节点。',
                content: suggestion.patch.content ?? '## 来源\n用户补充或上传资料。',
                type: suggestion.patch.type ?? 'feature',
                status: 'pending',
                level: parent ? parent.level + 1 : 1,
                order: siblings.length,
                needsPolish: suggestion.patch.needsPolish ?? true,
                extractedFrom: null,
                techNotes: suggestion.patch.techNotes ?? null,
                children: [],
                docPath: suggestion.patch.docPath ?? null,
                audience: suggestion.patch.audience ?? null,
                specLens: suggestion.patch.specLens ?? specLensFromLegacyAudience(suggestion.patch.audience),
                sections: suggestion.patch.sections ?? {},
                handoffGoal: suggestion.patch.handoffGoal ?? null,
                qualityGate: suggestion.patch.qualityGate ?? null,
                backendContracts: normalizeBackendContracts(suggestion.patch.backendContracts),
                references: [],
                sourceKind: suggestion.patch.sourceKind,
                evidenceRefs: suggestion.patch.evidenceRefs ?? suggestion.evidenceRefs,
              },
            }
          }
          return {
            prdTree: normalizePrdTree(tree),
            nodeOperationSuggestions: {
              ...state.nodeOperationSuggestions,
              [scopeId]: (state.nodeOperationSuggestions[scopeId] ?? []).filter((item) => item.id !== suggestionId),
            },
            archiveDirty: true,
          }
        }),
      createQaIssue: (initialNodeId) => {
        const state = useAppStore.getState()
        const node = initialNodeId ? state.prdTree?.[initialNodeId] : null
        const issue = createEmptyQaIssue(node ? [createQaNodeRef(node)] : [])
        set({
          qaIssues: {
            ...state.qaIssues,
            [issue.id]: issue,
          },
          archiveDirty: true,
        })
        return issue.id
      },
      deleteQaIssue: (issueId) =>
        set((state) => {
          const { [issueId]: _removed, ...rest } = state.qaIssues
          return { qaIssues: rest, archiveDirty: true }
        }),
      appendQaIssueMessage: (issueId, message) =>
        set((state) => {
          const issue = state.qaIssues[issueId]
          if (!issue) return state
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: {
                ...issue,
                messages: [...issue.messages, message],
                updatedAt: new Date().toISOString(),
              },
            },
            archiveDirty: true,
          }
        }),
      removeLastQaIssueTurn: (issueId) => {
        let recalledMessage: ChatMessage | null = null
        set((state) => {
          const issue = state.qaIssues[issueId]
          if (!issue) return state
          const result = removeLatestUserTurn(issue.messages)
          if (!result.recalledMessage) return state
          recalledMessage = result.recalledMessage
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: {
                ...issue,
                messages: result.messages,
                status: 'draft',
                readyToConfirm: false,
                devReceivedAt: null,
                qaConfirmedAt: null,
                updatedAt: new Date().toISOString(),
              },
            },
            archiveDirty: true,
          }
        })
        return recalledMessage
      },
      applyQaIssuePatch: (issueId, patch) =>
        set((state) => {
          const issue = state.qaIssues[issueId]
          if (!issue) return state
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: applyQaPatch(issue, patch),
            },
            archiveDirty: true,
          }
        }),
      addQaIssueNodeRef: (issueId, nodeId) =>
        set((state) => {
          const issue = state.qaIssues[issueId]
          const node = state.prdTree?.[nodeId]
          if (!issue || !node || issue.nodeRefs.some((ref) => ref.nodeId === nodeId)) return state
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: {
                ...issue,
                nodeRefs: [...issue.nodeRefs, createQaNodeRef(node)],
                updatedAt: new Date().toISOString(),
              },
            },
            archiveDirty: true,
          }
        }),
      removeQaIssueNodeRef: (issueId, nodeId) =>
        set((state) => {
          const issue = state.qaIssues[issueId]
          if (!issue) return state
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: {
                ...issue,
                nodeRefs: issue.nodeRefs.filter((ref) => ref.nodeId !== nodeId),
                updatedAt: new Date().toISOString(),
              },
            },
            archiveDirty: true,
          }
        }),
      addQaIssueAttachment: (issueId, attachment) =>
        set((state) => {
          const issue = state.qaIssues[issueId]
          if (!issue) return state
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: {
                ...issue,
                attachments: [...issue.attachments, attachment],
                updatedAt: new Date().toISOString(),
              },
            },
            archiveDirty: true,
          }
        }),
      removeQaIssueAttachment: (issueId, attachmentId) =>
        set((state) => {
          const issue = state.qaIssues[issueId]
          if (!issue) return state
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: {
                ...issue,
                attachments: issue.attachments.filter((attachment) => attachment.id !== attachmentId),
                updatedAt: new Date().toISOString(),
              },
            },
            archiveDirty: true,
          }
        }),
      updateQaIssueStatus: (issueId, status) =>
        set((state) => {
          const issue = state.qaIssues[issueId]
          if (!issue) return state
          return {
            qaIssues: {
              ...state.qaIssues,
              [issueId]: issueWithStatus(issue, status),
            },
            archiveDirty: true,
          }
        }),
      setMapAdjustmentMessages: (messages) => {
        set((state) => ({
          mapAdjustmentMessages: typeof messages === 'function' ? messages(state.mapAdjustmentMessages) : messages,
          archiveDirty: true,
        }))
      },
      removeLastMapAdjustmentTurn: () => {
        let recalledMessage: ChatMessage | null = null
        set((state) => {
          const result = removeLatestUserTurn(state.mapAdjustmentMessages)
          if (!result.recalledMessage) return state
          recalledMessage = result.recalledMessage
          return {
            mapAdjustmentMessages: result.messages,
            pendingMapAdjustmentOperations: [],
            archiveDirty: true,
          }
        })
        return recalledMessage
      },
      setPendingMapAdjustmentOperations: (pendingMapAdjustmentOperations) =>
        set({ pendingMapAdjustmentOperations, archiveDirty: true }),
      clearMapAdjustmentState: () =>
        set({
          mapAdjustmentMessages: initialMapAdjustmentMessages,
          pendingMapAdjustmentOperations: [],
          archiveDirty: true,
        }),
      setAssetWorkbench: (assetWorkbench) =>
        set({ assetWorkbench: normalizeAssetWorkbench(assetWorkbench), archiveDirty: true }),
      addUiAssetRow: (row) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            uiRows: [row, ...state.assetWorkbench.uiRows],
          },
          archiveDirty: true,
        })),
      updateUiAssetRow: (rowId, patch) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            uiRows: state.assetWorkbench.uiRows.map((row) =>
              row.id === rowId ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row,
            ),
          },
          archiveDirty: true,
        })),
      removeUiAssetRow: (rowId) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            uiRows: state.assetWorkbench.uiRows.filter((row) => row.id !== rowId),
          },
          archiveDirty: true,
        })),
      replaceEffectAssetRows: (sourceRoot, rows) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            effectRows: mergeEffectAssetScanRows(state.assetWorkbench.effectRows, sourceRoot, rows),
            lastEffectScanRoot: sourceRoot,
          },
          archiveDirty: true,
        })),
      updateEffectAssetRow: (rowId, patch) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            effectRows: state.assetWorkbench.effectRows.map((row) =>
              row.id === rowId ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row,
            ),
          },
          archiveDirty: true,
        })),
      removeEffectAssetRow: (rowId) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            effectRows: state.assetWorkbench.effectRows.filter((row) => row.id !== rowId),
          },
          archiveDirty: true,
        })),
      replaceAudioAssetRows: (sourceRoot, rows) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            audioRows: mergeAudioAssetScanRows(state.assetWorkbench.audioRows, sourceRoot, rows),
            lastAudioScanRoot: sourceRoot,
          },
          archiveDirty: true,
        })),
      updateAudioAssetRow: (rowId, patch) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            audioRows: state.assetWorkbench.audioRows.map((row) =>
              row.id === rowId ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row,
            ),
          },
          archiveDirty: true,
        })),
      removeAudioAssetRow: (rowId) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            audioRows: state.assetWorkbench.audioRows.filter((row) => row.id !== rowId),
          },
          archiveDirty: true,
        })),
      upsertReusableLogicAssets: (assets) =>
        set((state) => {
          const normalizedAssets = normalizeReusableLogicAssets(assets)
          if (!normalizedAssets.length) return state
          const existingById = new Map(state.assetWorkbench.reusableLogicAssets.map((asset) => [asset.id, asset]))
          for (const asset of normalizedAssets) {
            const existing = existingById.get(asset.id)
            if (!existing) {
              existingById.set(asset.id, asset)
              continue
            }
            if (asset.status === 'candidate' && existing.status !== 'candidate') {
              existingById.set(asset.id, existing)
              continue
            }
            existingById.set(asset.id, {
              ...existing,
              ...asset,
              createdAt: existing.createdAt,
              updatedAt: new Date().toISOString(),
            })
          }
          return {
            assetWorkbench: {
              ...state.assetWorkbench,
              reusableLogicAssets: Array.from(existingById.values()),
            },
            archiveDirty: true,
          }
        }),
      updateReusableLogicAsset: (assetId, patch) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            reusableLogicAssets: state.assetWorkbench.reusableLogicAssets.map((asset) =>
              asset.id === assetId ? { ...asset, ...patch, updatedAt: new Date().toISOString() } : asset,
            ),
          },
          archiveDirty: true,
        })),
      approveReusableLogicAsset: (assetId) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            reusableLogicAssets: state.assetWorkbench.reusableLogicAssets.map((asset) =>
              asset.id === assetId ? { ...asset, status: 'approved', updatedAt: new Date().toISOString() } : asset,
            ),
          },
          archiveDirty: true,
        })),
      ignoreReusableLogicAsset: (assetId) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            reusableLogicAssets: state.assetWorkbench.reusableLogicAssets.map((asset) =>
              asset.id === assetId ? { ...asset, status: 'ignored', updatedAt: new Date().toISOString() } : asset,
            ),
          },
          archiveDirty: true,
        })),
      removeReusableLogicAsset: (assetId) =>
        set((state) => ({
          assetWorkbench: {
            ...state.assetWorkbench,
            reusableLogicAssets: state.assetWorkbench.reusableLogicAssets.filter((asset) => asset.id !== assetId),
          },
          archiveDirty: true,
        })),
      clearAssetWorkbench: () => set({ assetWorkbench: emptyAssetWorkbenchState(), archiveDirty: true }),
      applyNodePolish: (nodeId, patch) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state

          const summary = normalizeOptionalText(patch.summary)
          const content = normalizeOptionalText(patch.content)
          const techNotes = normalizeOptionalText(patch.techNotes)
          const handoffGoal = normalizeOptionalText(patch.handoffGoal)
          const qualityGate = normalizeOptionalText(patch.qualityGate)
          const performanceSpec = patch.performanceSpec === undefined
            ? node.performanceSpec
            : normalizePerformanceSpec(patch.performanceSpec)
          const nextNode = {
            ...node,
            summary: summary ?? node.summary,
            content: content ?? node.content,
            techNotes: techNotes ?? node.techNotes,
            sections: mergePolishSections(node.sections, patch.sections),
            handoffGoal: handoffGoal ?? node.handoffGoal,
            qualityGate: qualityGate ?? node.qualityGate,
            backendContracts: patch.backendContracts === undefined ? node.backendContracts : normalizeBackendContracts(patch.backendContracts),
            evidenceRefs: patch.evidenceRefs ?? node.evidenceRefs,
            performanceSpec,
          }
          const revision = createNodePolishRevision(
            nodeId,
            createDocumentSnapshot(node),
            createDocumentSnapshot(nextNode),
          )

          return {
            prdTree: {
              ...state.prdTree,
              [nodeId]: nextNode,
            },
            nodePolishRevisions: revision
              ? { ...state.nodePolishRevisions, [nodeId]: revision }
              : state.nodePolishRevisions,
            archiveDirty: true,
          }
        }),
      acceptNodePolishRevision: (nodeId) =>
        set((state) => {
          const revision = state.nodePolishRevisions[nodeId]
          if (!revision) return state
          const { [nodeId]: _removed, ...restRevisions } = state.nodePolishRevisions
          return {
            nodePolishRevisions: restRevisions,
            archiveDirty: true,
          }
        }),
      revertNodePolishRevision: (nodeId) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          const revision = state.nodePolishRevisions[nodeId]
          if (!node || !revision || !state.prdTree) return state
          const { [nodeId]: _removed, ...restRevisions } = state.nodePolishRevisions
          return {
            prdTree: {
              ...state.prdTree,
              [nodeId]: {
                ...node,
                summary: revision.before.summary,
                content: revision.before.content,
                techNotes: revision.before.techNotes,
                sections: 'sections' in revision.before ? revision.before.sections : node.sections,
                handoffGoal: 'handoffGoal' in revision.before ? revision.before.handoffGoal : node.handoffGoal,
                qualityGate: 'qualityGate' in revision.before ? revision.before.qualityGate : node.qualityGate,
                backendContracts: 'backendContracts' in revision.before ? revision.before.backendContracts : node.backendContracts,
                evidenceRefs: 'evidenceRefs' in revision.before ? revision.before.evidenceRefs : node.evidenceRefs,
                performanceSpec: 'performanceSpec' in revision.before ? revision.before.performanceSpec : node.performanceSpec,
              },
            },
            nodePolishRevisions: restRevisions,
            archiveDirty: true,
          }
        }),
      updateNodeStatus: (nodeId, status) =>
        set((state) => {
          if (!state.prdTree?.[nodeId]) return state
          const node = state.prdTree[nodeId]
          return {
            prdTree: {
              ...state.prdTree,
              [nodeId]: {
                ...node,
                status,
                needsPolish: status === 'pending_refine' ? true : node.needsPolish,
              },
            },
            archiveDirty: true,
          }
        }),
      applyRequirementPatch: (patch) => {
        set((state) => ({
          requirement: {
            ...state.requirement,
            ...patch,
            asset_dependencies: patch.asset_dependencies ?? state.requirement.asset_dependencies,
            ui_components: patch.ui_components ?? state.requirement.ui_components,
            suggested_answers: patch.suggested_answers ?? state.requirement.suggested_answers,
            slot_confidence: patch.slot_confidence ?? state.requirement.slot_confidence,
            missing_reasons: patch.missing_reasons ?? state.requirement.missing_reasons,
            next_question: 'next_question' in patch ? (patch.next_question ?? null) : state.requirement.next_question,
          },
          archiveDirty: true,
        }))
      },
      setMessages: (messages) => {
        set((state) => ({
          messages: typeof messages === 'function' ? messages(state.messages) : messages,
          archiveDirty: true,
        }))
      },
      setLatestRag: (latestRag) => set({ latestRag, archiveDirty: true }),
      setPrototypeHtml: (prototypeHtml, meta) =>
        set((state) => {
          if (!prototypeHtml) return { prototypeHtml: null, prototypeHistory: [], archiveDirty: true }
          const version = makePrototypeVersion(prototypeHtml, state.prototypeHistory, meta)
          return {
            prototypeHtml,
            prototypeHistory: [version, ...state.prototypeHistory].slice(0, PROTOTYPE_HISTORY_LIMIT),
            archiveDirty: true,
          }
        }),
      recordPrototypeHistory: (html, meta) =>
        set((state) => {
          const version = makePrototypeVersion(html, state.prototypeHistory, meta)
          return {
            prototypeHistory: [version, ...state.prototypeHistory].slice(0, PROTOTYPE_HISTORY_LIMIT),
            archiveDirty: true,
          }
        }),
      restorePrototypeVersion: (id) =>
        set((state) => {
          const version = state.prototypeHistory.find((item) => item.id === id)
          if (!version) return state
          return { prototypeHtml: version.html, archiveDirty: true }
        }),
      clearPrototypeHistory: () => set({ prototypeHistory: [], archiveDirty: true }),
      setPrototypeVariants: (variants) => set({ prototypeVariants: variants, selectedVariantIndex: -1, archiveDirty: true }),
      updatePrototypeVariant: (index, patch) =>
        set((state) => ({
          prototypeVariants: state.prototypeVariants.map((variant) =>
            variant.index === index ? { ...variant, ...patch } : variant,
          ),
          archiveDirty: true,
        })),
      selectPrototypeVariant: (index) =>
        set((state) => {
          const variant = state.prototypeVariants.find((item) => item.index === index)
          if (!variant) return state
          return {
            selectedVariantIndex: index,
            prototypeHtml: variant.html ?? state.prototypeHtml,
            archiveDirty: true,
          }
        }),
      clearPrototypeVariants: () => set({ prototypeVariants: [], selectedVariantIndex: -1, archiveDirty: true }),
      setNodePrototypeHtml: (nodeId, prototypeHtml, meta) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          if (!prototypeHtml) {
            return {
              ...setNodePrototypeState(state, nodeId, {
                ...current,
                prototypeHtml: null,
                prototypeHistory: [],
                prototypeVariants: [],
                selectedVariantIndex: -1,
                draftPrototypeSpec: null,
                standardPrototypeSpec: null,
              }),
              archiveDirty: true,
            }
          }
          const version = makePrototypeVersion(prototypeHtml, current.prototypeHistory, meta)
          return {
            ...setNodePrototypeState(state, nodeId, {
              ...withPrototypeSpec(current, meta?.prototypeSpec),
              prototypeHtml,
              prototypeHistory: [version, ...current.prototypeHistory].slice(0, PROTOTYPE_HISTORY_LIMIT),
            }),
            archiveDirty: true,
          }
        }),
      recordNodePrototypeHistory: (nodeId, html, meta) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          const version = makePrototypeVersion(html, current.prototypeHistory, meta)
          return {
            ...setNodePrototypeState(state, nodeId, {
              ...withPrototypeSpec(current, meta?.prototypeSpec),
              prototypeHistory: [version, ...current.prototypeHistory].slice(0, PROTOTYPE_HISTORY_LIMIT),
            }),
            archiveDirty: true,
          }
        }),
      restoreNodePrototypeVersion: (nodeId, id) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          const version = current.prototypeHistory.find((item) => item.id === id)
          if (!version) return state
          return { ...setNodePrototypeState(state, nodeId, withPrototypeSpec({ ...current, prototypeHtml: version.html }, version.prototypeSpec)), archiveDirty: true }
        }),
      clearNodePrototypeHistory: (nodeId) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          return {
            ...setNodePrototypeState(state, nodeId, {
              ...current,
              prototypeHtml: null,
              prototypeHistory: [],
              prototypeVariants: [],
              selectedVariantIndex: -1,
              draftPrototypeSpec: null,
              standardPrototypeSpec: null,
            }),
            archiveDirty: true,
          }
        }),
      setNodePrototypeSpec: (nodeId, mode, spec) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          return {
            ...setNodePrototypeState(state, nodeId, {
              ...current,
              draftPrototypeSpec: mode === 'draft' ? spec : current.draftPrototypeSpec,
              standardPrototypeSpec: mode === 'standard' ? spec : current.standardPrototypeSpec,
            }),
            archiveDirty: true,
          }
        }),
      setNodePrototypeVariants: (nodeId, variants) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          return {
            ...setNodePrototypeState(state, nodeId, {
              ...current,
              prototypeVariants: variants.map((variant) => ({ ...variant, prototypeSpec: variant.prototypeSpec ?? null })),
              selectedVariantIndex: -1,
            }),
            archiveDirty: true,
          }
        }),
      updateNodePrototypeVariant: (nodeId, index, patch) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          return {
            ...setNodePrototypeState(state, nodeId, {
              ...withPrototypeSpec(current, patch.prototypeSpec),
              prototypeVariants: current.prototypeVariants.map((variant) =>
                variant.index === index ? { ...variant, ...patch, prototypeSpec: patch.prototypeSpec ?? variant.prototypeSpec ?? null } : variant,
              ),
            }),
            archiveDirty: true,
          }
        }),
      selectNodePrototypeVariant: (nodeId, index) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          const variant = current.prototypeVariants.find((item) => item.index === index)
          if (!variant) return state
          return {
            ...setNodePrototypeState(state, nodeId, {
              ...withPrototypeSpec(current, variant.prototypeSpec),
              selectedVariantIndex: index,
              prototypeHtml: variant.html ?? current.prototypeHtml,
            }),
            archiveDirty: true,
          }
        }),
      clearNodePrototypeVariants: (nodeId) =>
        set((state) => {
          const current = getNodePrototypeState(state, nodeId)
          return { ...setNodePrototypeState(state, nodeId, { ...current, prototypeVariants: [], selectedVariantIndex: -1 }), archiveDirty: true }
        }),
      updateSettings: (settings) => set({ settings, archiveDirty: true }),
      resetSession: () => set({ messages: initialMessages, latestRag: null, prototypeHtml: null, prototypeHistory: [], prototypeVariants: [], selectedVariantIndex: -1, archiveDirty: true }),
      resetRequirement: () => set({ requirement: emptyRequirement, latestRag: null, prototypeHtml: null, prototypeHistory: [], prototypeVariants: [], selectedVariantIndex: -1, archiveDirty: true }),
      setPrdTree: (prdTree) => set({ prdTree: normalizePrdTree(prdTree), archiveDirty: true }),
      setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
      setDecompositionStatus: (decompositionStatus) => set({ decompositionStatus }),
      appendDecompositionStep: (step) =>
        set((state) => ({ decompositionSteps: [...state.decompositionSteps, step] })),
      updateDecompositionStep: (index, update) =>
        set((state) => ({
          decompositionSteps: state.decompositionSteps.map((s, i) =>
            i === index ? { ...s, ...update } : s
          ),
        })),
      mergePartialTree: (nodes) =>
        set((state) => ({ prdTree: normalizePrdTree({ ...(state.prdTree ?? {}), ...nodes }), archiveDirty: true })),
      resetDecomposition: () =>
        set({
          prdTree: null,
          selectedNodeId: null,
          decompositionStatus: 'idle',
          decompositionSteps: [],
          nodeChats: {},
          nodeOperationSuggestions: {},
          qaIssues: {},
          mapAdjustmentMessages: initialMapAdjustmentMessages,
          pendingMapAdjustmentOperations: [],
          assetWorkbench: emptyAssetWorkbenchState(),
          nodePrototypeStates: {},
          nodePolishRevisions: {},
          archiveDirty: true,
        }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      migrate: (persistedState: unknown, version: number): unknown => {
        if (version >= 3 && version <= 16) {
          const previous = persistedState as {
            requirement?: unknown
            messages?: unknown
            latestRag?: unknown
            settings?: unknown
            prdTree?: unknown
            selectedNodeId?: unknown
            prototypeHtml?: unknown
            prototypeHistory?: unknown
            prototypeVariants?: unknown
            selectedVariantIndex?: unknown
            nodeChats?: unknown
            nodePolishRevisions?: unknown
            nodePrototypeStates?: unknown
            nodeOperationSuggestions?: unknown
            qaIssues?: unknown
            mapAdjustmentMessages?: unknown
            pendingMapAdjustmentOperations?: unknown
            assetWorkbench?: unknown
            sourceDocument?: unknown
            projectWorkflow?: unknown
            currentArchivePath?: unknown
            lastSavedAt?: unknown
            archiveDirty?: unknown
          }
          const prdTree = normalizePersistedPrdTree(previous.prdTree, previous.nodePolishRevisions)
          return {
            requirement: previous.requirement ?? emptyRequirement,
            messages: previous.messages ?? initialMessages,
            latestRag: previous.latestRag ?? null,
            settings: previous.settings ?? defaultSettings,
            prdTree,
            selectedNodeId: prdTree ? previous.selectedNodeId ?? null : null,
            prototypeHtml: typeof previous.prototypeHtml === 'string' ? previous.prototypeHtml : null,
            prototypeHistory: Array.isArray(previous.prototypeHistory) ? previous.prototypeHistory.slice(0, PROTOTYPE_HISTORY_LIMIT) : [],
            prototypeVariants: Array.isArray(previous.prototypeVariants) ? previous.prototypeVariants : [],
            selectedVariantIndex: typeof previous.selectedVariantIndex === 'number' ? previous.selectedVariantIndex : -1,
            nodeChats: prdTree && previous.nodeChats && typeof previous.nodeChats === 'object' ? previous.nodeChats : {},
            nodePolishRevisions: prdTree && previous.nodePolishRevisions && typeof previous.nodePolishRevisions === 'object' ? previous.nodePolishRevisions : {},
            nodePrototypeStates: prdTree && previous.nodePrototypeStates && typeof previous.nodePrototypeStates === 'object' ? normalizeNodePrototypeStates(previous.nodePrototypeStates) : {},
            nodeOperationSuggestions: prdTree && previous.nodeOperationSuggestions && typeof previous.nodeOperationSuggestions === 'object' ? previous.nodeOperationSuggestions : {},
            qaIssues: prdTree && previous.qaIssues && typeof previous.qaIssues === 'object' ? previous.qaIssues : {},
            mapAdjustmentMessages: Array.isArray(previous.mapAdjustmentMessages) ? previous.mapAdjustmentMessages : initialMapAdjustmentMessages,
            pendingMapAdjustmentOperations: Array.isArray(previous.pendingMapAdjustmentOperations) ? previous.pendingMapAdjustmentOperations : [],
            assetWorkbench: normalizeAssetWorkbench(previous.assetWorkbench as AssetWorkbenchState | undefined),
            sourceDocument: previous.sourceDocument && typeof previous.sourceDocument === 'object' ? previous.sourceDocument : null,
            projectWorkflow: normalizeProjectWorkflow(previous.projectWorkflow),
            currentArchivePath: typeof previous.currentArchivePath === 'string' ? previous.currentArchivePath : null,
            lastSavedAt: typeof previous.lastSavedAt === 'string' ? previous.lastSavedAt : null,
            archiveDirty: typeof previous.archiveDirty === 'boolean' ? previous.archiveDirty : false,
          }
        }
        // Unknown version — safe reset
        return {
          requirement: emptyRequirement,
          messages: initialMessages,
          latestRag: null,
          settings: defaultSettings,
          prdTree: null,
          selectedNodeId: null,
          prototypeHtml: null,
          prototypeHistory: [],
          prototypeVariants: [],
          selectedVariantIndex: -1,
          nodeChats: {},
          nodePolishRevisions: {},
          nodePrototypeStates: {},
          nodeOperationSuggestions: {},
          qaIssues: {},
          mapAdjustmentMessages: initialMapAdjustmentMessages,
          pendingMapAdjustmentOperations: [],
          assetWorkbench: emptyAssetWorkbenchState(),
          sourceDocument: null,
          projectWorkflow: emptyProjectWorkflowState(),
          currentArchivePath: null,
          lastSavedAt: null,
          archiveDirty: false,
        }
      },
      partialize: (state) => ({
        requirement: state.requirement,
        messages: state.messages.map(persistableMessage),
        latestRag: state.latestRag,
        prototypeHtml: state.prototypeHtml,
        prototypeHistory: state.prototypeHistory,
        prototypeVariants: state.prototypeVariants,
        selectedVariantIndex: state.selectedVariantIndex,
        settings: state.settings,
        prdTree: state.prdTree as PrdTree | null,
        selectedNodeId: state.selectedNodeId,
        nodeChats: persistableNodeChats(state.nodeChats, 24),
        nodePolishRevisions: state.nodePolishRevisions,
        nodePrototypeStates: state.nodePrototypeStates,
        nodeOperationSuggestions: state.nodeOperationSuggestions,
        qaIssues: state.qaIssues,
        mapAdjustmentMessages: state.mapAdjustmentMessages.map(persistableMessage),
        pendingMapAdjustmentOperations: state.pendingMapAdjustmentOperations,
        assetWorkbench: state.assetWorkbench,
        sourceDocument: state.sourceDocument,
        projectWorkflow: state.projectWorkflow,
        currentArchivePath: state.currentArchivePath,
        lastSavedAt: state.lastSavedAt,
        archiveDirty: state.archiveDirty,
        // decompositionStatus: intentionally NOT persisted (session-only)
        // decompositionSteps: intentionally NOT persisted (session-only)
      }),
    },
  ),
)
