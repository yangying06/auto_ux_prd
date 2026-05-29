// PrdNode — a single node in the decomposed PRD tree.
export type PrdNodeAudience =
  | 'overview'
  | 'client'
  | 'server'
  | 'config'
  | 'api'
  | 'acceptance'
  | 'appendix'
  | 'mixed'

export interface PrdNode {
  id: string                              // e.g. "CE-01". Stable unique ID.
  parentId: string | null                 // null for root-level nodes
  label: string                           // Short display name (3-8 words)
  summary: string                         // One sentence summary
  content: string                         // Full extracted text from PRD
  type: 'module' | 'feature' | 'ui'      // module=top-level, feature=sub-function, ui=UI interaction
  status: 'pending' | 'done'             // polishing status
  level: number                           // depth in tree; root children = 1
  order: number                           // sort position among siblings (0-indexed)
  needsPolish: boolean                    // true if node describes a UI interaction needing Deep Forge
  extractedFrom: string | null            // source text range (null in Phase 1, used in Phase 2+)
  techNotes: string | null               // optional implementation notes
  children: string[]                      // child node IDs (populated by normalizer, not Claude)
  docPath?: string | null                 // export path for a Markdown document packet
  audience?: PrdNodeAudience | null       // primary downstream consumer / responsibility axis
  handoffGoal?: string | null             // how an AI agent should use this document
  qualityGate?: string | null             // checks that prove the document is ready for handoff
}

// PrdTree — the flat node map stored in Zustand.
// Keyed by node ID for O(1) lookup.
export type PrdTree = Record<string, PrdNode>

// DecompositionStatus — lifecycle of the decomposition process.
export type DecompositionStatus = 'idle' | 'decomposing' | 'done' | 'error'

// DecompositionStep — one step in the progress display.
export interface DecompositionStep {
  label: string                           // e.g. "Decomposing top-level modules" or "Expanding: Pyramid Lottery"
  status: 'pending' | 'active' | 'complete' | 'error'
}
