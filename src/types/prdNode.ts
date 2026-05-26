// PrdNode — a single node in the decomposed PRD tree.
// Field spec locked by D-04 (CONTEXT.md). Do not add or remove fields.
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
