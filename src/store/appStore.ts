import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultSettings } from '../data/defaultSettings'
import type { AppSettings, ChatMessage, RagSearchResult } from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'
import type { CreatePageNodeInput, DecompositionStatus, DecompositionStep, MapAdjustmentOperation, PrdNode, PrdNodeOperationSuggestion, PrdNodeReference, PrdTree, UpdateNodePatch } from '../types/prdNode'
import type { PrototypeVariant } from '../types/prototypeVariant'

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
const STORAGE_VERSION = 7
const PROTOTYPE_HISTORY_LIMIT = 4

export interface PrototypeVersion {
  id: string
  label: string
  html: string
  createdAt: string
  mode: 'create' | 'update' | 'restore'
  note: string | null
}

interface PrototypeVersionMeta {
  mode?: PrototypeVersion['mode']
  note?: string | null
}

interface NodePolishPatch {
  summary?: string | null
  content?: string | null
  techNotes?: string | null
}

function normalizeOptionalText(value: string | null | undefined) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
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
  return {
    ...patch,
    label: patch.label?.trim() || undefined,
    summary: patch.summary?.trim() || undefined,
    content: patch.content?.trim() || undefined,
    docPath: patch.docPath === undefined ? undefined : normalizeOptionalText(patch.docPath),
    references: patch.references ? normalizeReferences(patch.references) : undefined,
    techNotes: patch.techNotes === undefined ? undefined : normalizeOptionalText(patch.techNotes),
    handoffGoal: patch.handoffGoal === undefined ? undefined : normalizeOptionalText(patch.handoffGoal),
    qualityGate: patch.qualityGate === undefined ? undefined : normalizeOptionalText(patch.qualityGate),
    sourceKind: patch.sourceKind,
    evidenceRefs: patch.evidenceRefs,
  }
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

function persistableMessage(message: ChatMessage): ChatMessage {
  if (typeof message.content === 'string') return message

  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type === 'text') return { ...block }
      return { type: 'image', source: { ...block.source } }
    }),
  }
}

function persistableNodeChats(nodeChats: Record<string, ChatMessage[]>) {
  return Object.fromEntries(
    Object.entries(nodeChats).map(([nodeId, messages]) => [
      nodeId,
      messages.slice(-24).map(persistableMessage),
    ]),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

function normalizePersistedPrdTree(value: unknown): PrdTree | null {
  if (!isRecord(value)) return null
  if (persistedTreeHasLocalTemplates(value)) return null
  const normalized = Object.fromEntries(
    Object.entries(value).map(([id, rawNode]) => {
      const node = rawNode as PrdNode
      return [id, {
        ...node,
        type: node.type ?? 'feature',
        status: node.status ?? 'pending',
        references: normalizeReferences(node.references),
      }]
    })
  ) as PrdTree
  return rebuildPrdTreeLinks(normalized)
}

export const initialMessages: ChatMessage[] = [
  {
    role: 'assistant',
    content: '你好！我是你的 UX 需求打磨助手。请描述你想实现的交互效果，我会帮你梳理触发条件、执行规则和资源依赖。',
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
  }
}

interface AppStoreState {
  requirement: UXRequirementState
  messages: ChatMessage[]
  latestRag: RagSearchResult | null
  prototypeHtml: string | null
  prototypeHistory: PrototypeVersion[]
  prototypeVariants: PrototypeVariant[]
  selectedVariantIndex: number
  settings: AppSettings
  prdTree: PrdTree | null
  selectedNodeId: string | null
  decompositionStatus: DecompositionStatus
  decompositionSteps: DecompositionStep[]
  nodeChats: Record<string, ChatMessage[]>
  nodeOperationSuggestions: Record<string, PrdNodeOperationSuggestion[]>
  createPageNode: (input: CreatePageNodeInput) => string
  updateNode: (nodeId: string, patch: UpdateNodePatch) => void
  updateNodeContent: (nodeId: string, content: string) => void
  deleteNode: (nodeId: string) => void
  applyMapAdjustmentOperations: (operations: MapAdjustmentOperation[]) => void
  setNodeDocPath: (nodeId: string, docPath: string | null) => void
  appendNodeMessage: (nodeId: string, msg: ChatMessage) => void
  clearNodeChat: (nodeId: string) => void
  setNodeOperationSuggestions: (scopeId: string, suggestions: PrdNodeOperationSuggestion[]) => void
  dismissNodeOperationSuggestion: (scopeId: string, suggestionId: string) => void
  applyNodeOperationSuggestion: (scopeId: string, suggestionId: string) => void
  applyNodePolish: (nodeId: string, patch: NodePolishPatch) => void
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
      settings: defaultSettings,
      prdTree: null,
      selectedNodeId: null,
      decompositionStatus: 'idle',
      decompositionSteps: [],
      nodeChats: {},
      nodeOperationSuggestions: {},
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
          handoffGoal: `打磨 ${title} 页面的交互设计规格。`,
          qualityGate: '页面目标、入口、UI 元素、状态、跳转关系和验收点清晰。',
          references: [],
        }
        set({ prdTree: rebuildPrdTreeLinks({ ...tree, [id]: node }), selectedNodeId: id })
        return id
      },
      updateNode: (nodeId, patch) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state
          const nextPatch = sanitizePatch(patch)
          return {
            prdTree: rebuildPrdTreeLinks({
              ...state.prdTree,
              [nodeId]: { ...node, ...nextPatch },
            }),
          }
        }),
      updateNodeContent: (nodeId, content) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state
          return { prdTree: { ...state.prdTree, [nodeId]: { ...node, content } } }
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
          }
        }),
      applyMapAdjustmentOperations: (operations) =>
        set((state) => {
          let tree = state.prdTree ?? {}
          let selectedNodeId = state.selectedNodeId
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
                  handoffGoal: `打磨 ${title} 页面的交互设计规格。`,
                  qualityGate: '页面目标、入口、UI 元素、状态、跳转关系和验收点清晰。',
                  references: [],
                },
              }
              selectedNodeId = id
            } else if (operation.type === 'delete_node') {
              if (!tree[operation.nodeId]) continue
              const removedIds = collectDescendantIds(tree, operation.nodeId)
              tree = Object.fromEntries(Object.entries(tree).filter(([id]) => !removedIds.has(id))) as PrdTree
              if (selectedNodeId && removedIds.has(selectedNodeId)) selectedNodeId = null
            } else if (operation.type === 'update_node') {
              const node = tree[operation.nodeId]
              if (!node) continue
              tree = { ...tree, [operation.nodeId]: { ...node, ...sanitizePatch(operation.patch) } }
            } else if (operation.type === 'move_content') {
              const from = tree[operation.fromNodeId]
              const to = tree[operation.toNodeId]
              const content = operation.content.trim()
              if (!from || !to || !content) continue
              tree = {
                ...tree,
                [operation.fromNodeId]: { ...from, content: from.content.replace(content, '').trim() || from.content },
                [operation.toNodeId]: { ...to, content: `${to.content.trim()}\n\n${content}`.trim(), status: to.status === 'done' ? 'done' : 'pending_refine' },
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
          return { prdTree: rebuildPrdTreeLinks(tree), selectedNodeId }
        }),
      setNodeDocPath: (nodeId, docPath) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state
          return { prdTree: { ...state.prdTree, [nodeId]: { ...node, docPath } } }
        }),
      appendNodeMessage: (nodeId, msg) =>
        set((state) => ({
          nodeChats: {
            ...state.nodeChats,
            [nodeId]: [...(state.nodeChats[nodeId] ?? []), msg],
          },
        })),
      clearNodeChat: (nodeId) =>
        set((state) => {
          const { [nodeId]: _, ...rest } = state.nodeChats
          return { nodeChats: rest }
        }),
      setNodeOperationSuggestions: (scopeId, suggestions) =>
        set((state) => ({
          nodeOperationSuggestions: {
            ...state.nodeOperationSuggestions,
            [scopeId]: suggestions.map((suggestion) => ({ ...suggestion, status: 'pending' })),
          },
        })),
      dismissNodeOperationSuggestion: (scopeId, suggestionId) =>
        set((state) => ({
          nodeOperationSuggestions: {
            ...state.nodeOperationSuggestions,
            [scopeId]: (state.nodeOperationSuggestions[scopeId] ?? []).filter((suggestion) => suggestion.id !== suggestionId),
          },
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
            tree = { ...tree, [targetId]: { ...node, ...sanitizePatch(suggestion.patch as UpdateNodePatch) } }
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
                handoffGoal: suggestion.patch.handoffGoal ?? null,
                qualityGate: suggestion.patch.qualityGate ?? null,
                references: [],
                sourceKind: suggestion.patch.sourceKind,
                evidenceRefs: suggestion.patch.evidenceRefs ?? suggestion.evidenceRefs,
              },
            }
          }
          return {
            prdTree: rebuildPrdTreeLinks(tree),
            nodeOperationSuggestions: {
              ...state.nodeOperationSuggestions,
              [scopeId]: (state.nodeOperationSuggestions[scopeId] ?? []).filter((item) => item.id !== suggestionId),
            },
          }
        }),
      applyNodePolish: (nodeId, patch) =>
        set((state) => {
          const node = state.prdTree?.[nodeId]
          if (!node || !state.prdTree) return state

          const summary = normalizeOptionalText(patch.summary)
          const content = normalizeOptionalText(patch.content)
          const techNotes = normalizeOptionalText(patch.techNotes)

          return {
            prdTree: {
              ...state.prdTree,
              [nodeId]: {
                ...node,
                summary: summary ?? node.summary,
                content: content ?? node.content,
                techNotes: techNotes ?? node.techNotes,
              },
            },
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
                needsPolish: status === 'done' ? false : node.needsPolish,
              },
            },
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
        }))
      },
      setMessages: (messages) => {
        set((state) => ({
          messages: typeof messages === 'function' ? messages(state.messages) : messages,
        }))
      },
      setLatestRag: (latestRag) => set({ latestRag }),
      setPrototypeHtml: (prototypeHtml, meta) =>
        set((state) => {
          if (!prototypeHtml) return { prototypeHtml: null, prototypeHistory: [] }
          const version = makePrototypeVersion(prototypeHtml, state.prototypeHistory, meta)
          return {
            prototypeHtml,
            prototypeHistory: [version, ...state.prototypeHistory].slice(0, PROTOTYPE_HISTORY_LIMIT),
          }
        }),
      recordPrototypeHistory: (html, meta) =>
        set((state) => {
          const version = makePrototypeVersion(html, state.prototypeHistory, meta)
          return {
            prototypeHistory: [version, ...state.prototypeHistory].slice(0, PROTOTYPE_HISTORY_LIMIT),
          }
        }),
      restorePrototypeVersion: (id) =>
        set((state) => {
          const version = state.prototypeHistory.find((item) => item.id === id)
          if (!version) return state
          return { prototypeHtml: version.html }
        }),
      clearPrototypeHistory: () => set({ prototypeHistory: [] }),
      setPrototypeVariants: (variants) => set({ prototypeVariants: variants, selectedVariantIndex: -1 }),
      updatePrototypeVariant: (index, patch) =>
        set((state) => ({
          prototypeVariants: state.prototypeVariants.map((variant) =>
            variant.index === index ? { ...variant, ...patch } : variant,
          ),
        })),
      selectPrototypeVariant: (index) =>
        set((state) => {
          const variant = state.prototypeVariants.find((item) => item.index === index)
          if (!variant) return state
          return {
            selectedVariantIndex: index,
            prototypeHtml: variant.html ?? state.prototypeHtml,
          }
        }),
      clearPrototypeVariants: () => set({ prototypeVariants: [], selectedVariantIndex: -1 }),
      updateSettings: (settings) => set({ settings }),
      resetSession: () => set({ messages: initialMessages, latestRag: null, prototypeHtml: null, prototypeHistory: [], prototypeVariants: [], selectedVariantIndex: -1 }),
      resetRequirement: () => set({ requirement: emptyRequirement, latestRag: null, prototypeHtml: null, prototypeHistory: [], prototypeVariants: [], selectedVariantIndex: -1 }),
      setPrdTree: (prdTree) => set({ prdTree: rebuildPrdTreeLinks(prdTree) }),
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
        set((state) => ({ prdTree: rebuildPrdTreeLinks({ ...(state.prdTree ?? {}), ...nodes }) })),
      resetDecomposition: () =>
        set({ prdTree: null, selectedNodeId: null, decompositionStatus: 'idle', decompositionSteps: [], nodeChats: {}, nodeOperationSuggestions: {} }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      migrate: (persistedState: unknown, version: number): unknown => {
        if (version === 3 || version === 4 || version === 5 || version === 6) {
          const previous = persistedState as {
            requirement?: unknown
            messages?: unknown
            latestRag?: unknown
            settings?: unknown
            prdTree?: unknown
            selectedNodeId?: unknown
            prototypeHtml?: unknown
            prototypeHistory?: unknown
            nodeChats?: unknown
          }
          const prdTree = normalizePersistedPrdTree(previous.prdTree)
          return {
            requirement: previous.requirement ?? emptyRequirement,
            messages: previous.messages ?? initialMessages,
            latestRag: previous.latestRag ?? null,
            settings: previous.settings ?? defaultSettings,
            prdTree,
            selectedNodeId: prdTree ? previous.selectedNodeId ?? null : null,
            prototypeHtml: typeof previous.prototypeHtml === 'string' ? previous.prototypeHtml : null,
            prototypeHistory: Array.isArray(previous.prototypeHistory) ? previous.prototypeHistory.slice(0, PROTOTYPE_HISTORY_LIMIT) : [],
            nodeChats: prdTree && previous.nodeChats && typeof previous.nodeChats === 'object' ? previous.nodeChats : {},
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
          nodeChats: {},
        }
      },
      partialize: (state) => ({
        requirement: state.requirement,
        messages: state.messages.map(persistableMessage),
        latestRag: state.latestRag,
        prototypeHtml: state.prototypeHtml,
        prototypeHistory: state.prototypeHistory,
        settings: state.settings,
        prdTree: state.prdTree as PrdTree | null,
        selectedNodeId: state.selectedNodeId,
        nodeChats: persistableNodeChats(state.nodeChats),
        // decompositionStatus: intentionally NOT persisted (session-only)
        // decompositionSteps: intentionally NOT persisted (session-only)
      }),
    },
  ),
)
