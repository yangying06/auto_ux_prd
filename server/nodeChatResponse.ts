import { normalizePerformanceSpec } from '../src/lib/performanceOrchestration'
import type {
  PrdNode,
  PrdNodeBackendContractKind,
  PrdNodeBackendContractRef,
  PrdNodeEvidenceRef,
  PrdNodeSourceKind,
  PrdPerformanceSpec,
} from '../src/types/prdNode'

export type NodeChatIntent = 'document_polish' | 'prototype_update' | 'reference_feedback'

export interface NodePolishPatch {
  summary?: string | null
  content?: string | null
  techNotes?: string | null
  sections?: PrdNode['sections']
  handoffGoal?: string | null
  qualityGate?: string | null
  backendContracts?: PrdNodeBackendContractRef[]
  evidenceRefs?: PrdNodeEvidenceRef[]
  performanceSpec?: PrdPerformanceSpec | null
}

interface NodeChatSuffix {
  nodeComplete?: boolean
  nodePatch?: NodePolishPatch
  intents?: unknown
  prototypeInstruction?: unknown
}

export interface ParsedNodeChatSuffix {
  reply: string
  nodeComplete: boolean
  nodePatch: NodePolishPatch | null
  intents: NodeChatIntent[]
  prototypeInstruction: string | null
}

const NODE_CHAT_INTENTS = new Set<NodeChatIntent>([
  'document_polish',
  'prototype_update',
  'reference_feedback',
])

function normalizeNullableString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeNullableString(item))
    .filter((item): item is string => Boolean(item))
}

function normalizeSourceKind(value: unknown, fallback: PrdNodeSourceKind = 'user'): PrdNodeSourceKind {
  if (value === 'prd' || value === 'user' || value === 'upload') return value
  return fallback
}

function normalizeEvidenceRefs(value: unknown, fallbackSourceKind: PrdNodeSourceKind, fallbackLabel: string): PrdNodeEvidenceRef[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8)
    .map((item): PrdNodeEvidenceRef | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const sourceLabel = normalizeNullableString(candidate.sourceLabel ?? candidate.source_label ?? candidate.label) ?? fallbackLabel
      return {
        sourceKind: normalizeSourceKind(candidate.sourceKind ?? candidate.source_kind, fallbackSourceKind),
        sourceLabel,
        quote: normalizeNullableString(candidate.quote ?? candidate.excerpt),
      }
    })
    .filter((item): item is PrdNodeEvidenceRef => Boolean(item))
}

function normalizeSections(value: unknown): PrdNode['sections'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const sections: PrdNode['sections'] = {}

  for (const key of ['view', 'interaction', 'data'] as const) {
    const raw = source[key]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const candidate = raw as Record<string, unknown>
    const title = normalizeNullableString(candidate.title ?? candidate.label)
    const summary = normalizeNullableString(candidate.summary ?? candidate.description)
    const content = normalizeNullableString(candidate.content ?? candidate.body ?? candidate.detail)
    const evidenceRefs = normalizeEvidenceRefs(
      candidate.evidenceRefs ?? candidate.evidence_refs ?? candidate.sources,
      'user',
      title ?? summary ?? key,
    )
    const openQuestions = normalizeStringArray(candidate.openQuestions ?? candidate.open_questions ?? candidate.questions)
    if (!title && !summary && !content && !evidenceRefs.length && !openQuestions.length) continue
    sections[key] = {
      title,
      summary,
      content,
      evidenceRefs,
      openQuestions,
    }
  }

  return Object.keys(sections).length ? sections : undefined
}

function normalizeBackendContractKind(value: unknown): PrdNodeBackendContractKind | null {
  if (value === 'api' || value === 'config' || value === 'server' || value === 'data') return value
  return null
}

function normalizeBackendContracts(value: unknown): PrdNodeBackendContractRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const contracts = value.slice(0, 12)
    .map((item): PrdNodeBackendContractRef | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const kind = normalizeBackendContractKind(candidate.kind ?? candidate.type)
      const title = normalizeNullableString(candidate.title ?? candidate.label ?? candidate.name)
      if (!kind || !title) return null
      return {
        id: normalizeNullableString(candidate.id),
        title,
        kind,
        summary: normalizeNullableString(candidate.summary ?? candidate.description),
        fields: normalizeStringArray(candidate.fields ?? candidate.params ?? candidate.schema),
        targetNodeId: normalizeNullableString(candidate.targetNodeId ?? candidate.target_node_id),
        evidenceRefs: normalizeEvidenceRefs(
          candidate.evidenceRefs ?? candidate.evidence_refs ?? candidate.sources,
          'user',
          title,
        ),
      }
    })
    .filter((item): item is PrdNodeBackendContractRef => Boolean(item))
  return contracts.length ? contracts : undefined
}

function normalizeNodePolishPatch(value: unknown): NodePolishPatch | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const patch: NodePolishPatch = {}

  if ('summary' in candidate) patch.summary = normalizeNullableString(candidate.summary)
  if ('content' in candidate) patch.content = normalizeNullableString(candidate.content)
  if ('techNotes' in candidate) patch.techNotes = normalizeNullableString(candidate.techNotes)
  if (!patch.techNotes && 'tech_notes' in candidate) patch.techNotes = normalizeNullableString(candidate.tech_notes)
  if ('sections' in candidate || 'sectionDrafts' in candidate || 'section_drafts' in candidate || 'lenses' in candidate) {
    patch.sections = normalizeSections(candidate.sections ?? candidate.sectionDrafts ?? candidate.section_drafts ?? candidate.lenses)
  }
  if ('handoffGoal' in candidate) patch.handoffGoal = normalizeNullableString(candidate.handoffGoal)
  if (!patch.handoffGoal && 'handoff_goal' in candidate) patch.handoffGoal = normalizeNullableString(candidate.handoff_goal)
  if ('qualityGate' in candidate) patch.qualityGate = normalizeNullableString(candidate.qualityGate)
  if (!patch.qualityGate && 'quality_gate' in candidate) patch.qualityGate = normalizeNullableString(candidate.quality_gate)
  if ('backendContracts' in candidate || 'backend_contracts' in candidate) {
    patch.backendContracts = normalizeBackendContracts(candidate.backendContracts ?? candidate.backend_contracts)
  }
  if ('evidenceRefs' in candidate || 'evidence_refs' in candidate) {
    patch.evidenceRefs = normalizeEvidenceRefs(candidate.evidenceRefs ?? candidate.evidence_refs, 'user', 'Deep Forge')
  }
  if ('performanceSpec' in candidate) patch.performanceSpec = normalizePerformanceSpec(candidate.performanceSpec)
  if (!patch.performanceSpec && 'performance_spec' in candidate) patch.performanceSpec = normalizePerformanceSpec(candidate.performance_spec)

  return Object.keys(patch).length ? patch : null
}

function normalizeIntents(value: unknown): NodeChatIntent[] {
  if (!Array.isArray(value)) return []
  const intents: NodeChatIntent[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (!NODE_CHAT_INTENTS.has(item as NodeChatIntent)) continue
    const intent = item as NodeChatIntent
    if (!intents.includes(intent)) intents.push(intent)
  }
  return intents
}

export function extractNodeChatSuffix(rawText: string): ParsedNodeChatSuffix {
  const fallback = {
    reply: rawText,
    nodeComplete: false,
    nodePatch: null,
    intents: [],
    prototypeInstruction: null,
  }

  const lastBrace = rawText.lastIndexOf('}')
  if (lastBrace === -1) return fallback

  for (let index = lastBrace; index >= 0; index -= 1) {
    if (rawText[index] !== '{') continue
    try {
      const suffix = JSON.parse(rawText.slice(index, lastBrace + 1)) as NodeChatSuffix
      if (!suffix || typeof suffix !== 'object' || !('nodeComplete' in suffix)) continue
      return {
        reply: rawText.slice(0, index).trim() || rawText,
        nodeComplete: suffix.nodeComplete === true,
        nodePatch: normalizeNodePolishPatch(suffix.nodePatch),
        intents: normalizeIntents(suffix.intents),
        prototypeInstruction: normalizeNullableString(suffix.prototypeInstruction),
      }
    } catch {
      // Try the previous opening brace. JSON suffixes may contain nested objects.
    }
  }

  return fallback
}
