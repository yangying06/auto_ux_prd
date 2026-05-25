import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultSettings } from '../data/defaultSettings'
import type { AppSettings, ChatMessage, RagSearchResult } from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'

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
const STORAGE_VERSION = 3

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
  applyRequirementPatch: (patch: Partial<UXRequirementState>) => void
  setMessages: (messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void
  setLatestRag: (rag: RagSearchResult | null) => void
  setPrototypeHtml: (html: string | null) => void
  updateSettings: (settings: AppSettings) => void
  resetSession: () => void
  resetRequirement: () => void
}

export const useAppStore = create<AppStoreState>()(
  persist(
    (set) => ({
      requirement: emptyRequirement,
      messages: initialMessages,
      latestRag: null,
      prototypeHtml: null,
      settings: defaultSettings,
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
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      partialize: (state) => ({
        requirement: state.requirement,
        messages: state.messages,
        latestRag: state.latestRag,
        settings: state.settings,
      }),
    },
  ),
)
