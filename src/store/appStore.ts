import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultSettings } from '../data/defaultSettings'
import type { AppSettings, ChatMessage, RagSearchResult } from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'
import type { DecompositionStatus, DecompositionStep, PrdNode, PrdTree } from '../types/prdNode'
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
const PROTOTYPE_HISTORY_LIMIT = 8

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
  return rebuildPrdTreeLinks(value as PrdTree)
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
  appendNodeMessage: (nodeId: string, msg: ChatMessage) => void
  clearNodeChat: (nodeId: string) => void
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
          return {
            prdTree: {
              ...state.prdTree,
              [nodeId]: { ...state.prdTree[nodeId], status },
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
      clearPrototypeHistory: () => set({ prototypeHtml: null, prototypeHistory: [] }),
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
        set({ prdTree: null, selectedNodeId: null, decompositionStatus: 'idle', decompositionSteps: [], nodeChats: {} }),
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
            prototypeHistory: Array.isArray(previous.prototypeHistory) ? previous.prototypeHistory : [],
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
