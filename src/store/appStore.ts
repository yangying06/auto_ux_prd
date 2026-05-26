import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultSettings } from '../data/defaultSettings'
import type { AppSettings, ChatMessage, RagSearchResult } from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'
import type { DecompositionStatus, DecompositionStep, PrdNode, PrdTree } from '../types/prdNode'

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
const STORAGE_VERSION = 4

export const initialMessages: ChatMessage[] = [
  {
    role: 'assistant',
    content: '你好！我是你的 UX 需求打磨助手。请描述你想实现的交互效果，我会帮你梳理触发条件、执行规则和资源依赖。',
  },
]

interface AppStoreState {
  requirement: UXRequirementState
  messages: ChatMessage[]
  latestRag: RagSearchResult | null
  prototypeHtml: string | null
  settings: AppSettings
  prdTree: PrdTree | null
  selectedNodeId: string | null
  decompositionStatus: DecompositionStatus
  decompositionSteps: DecompositionStep[]
  applyRequirementPatch: (patch: Partial<UXRequirementState>) => void
  setMessages: (messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void
  setLatestRag: (rag: RagSearchResult | null) => void
  setPrototypeHtml: (html: string | null) => void
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
      settings: defaultSettings,
      prdTree: null,
      selectedNodeId: null,
      decompositionStatus: 'idle',
      decompositionSteps: [],
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
      setPrototypeHtml: (prototypeHtml) => set({ prototypeHtml }),
      updateSettings: (settings) => set({ settings }),
      resetSession: () => set({ messages: initialMessages, latestRag: null, prototypeHtml: null }),
      resetRequirement: () => set({ requirement: emptyRequirement, latestRag: null, prototypeHtml: null }),
      setPrdTree: (prdTree) => set({ prdTree }),
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
        set((state) => ({ prdTree: { ...(state.prdTree ?? {}), ...nodes } })),
      resetDecomposition: () =>
        set({ prdTree: null, decompositionStatus: 'idle', decompositionSteps: [] }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 3) {
          const v3 = persistedState as {
            requirement?: unknown
            messages?: unknown
            latestRag?: unknown
            settings?: unknown
          }
          return {
            requirement: v3.requirement ?? emptyRequirement,
            messages: v3.messages ?? initialMessages,
            latestRag: v3.latestRag ?? null,
            settings: v3.settings ?? defaultSettings,
            prdTree: null,
            selectedNodeId: null,
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
        }
      },
      partialize: (state) => ({
        requirement: state.requirement,
        messages: state.messages,
        latestRag: state.latestRag,
        settings: state.settings,
        prdTree: state.prdTree,
        selectedNodeId: state.selectedNodeId,
        // decompositionStatus: intentionally NOT persisted (session-only)
        // decompositionSteps: intentionally NOT persisted (session-only)
      }),
    },
  ),
)
