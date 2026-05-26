---
phase: 01-foundation-pipeline
plan: "01"
subsystem: types-store-server
tags: [types, zustand, express, infrastructure]
dependency_graph:
  requires: []
  provides: [PrdNode-types, PrdTree-store-slice, express-10mb-body]
  affects: [src/store/appStore.ts, src/types/prdNode.ts, server/index.ts]
tech_stack:
  added: []
  patterns: [zustand-persist-migrate, flat-node-map]
key_files:
  created:
    - src/types/prdNode.ts
  modified:
    - src/store/appStore.ts
    - server/index.ts
decisions:
  - "Store version bumped 3→4 with migrate function carrying forward all v3 fields"
  - "prdTree and selectedNodeId persisted; decompositionStatus and decompositionSteps are session-only (not persisted)"
  - "extractedFrom left null in Phase 1 per research recommendation; Phase 2+ will populate"
metrics:
  duration: "5 minutes"
  completed: "2026-05-26T10:23:59Z"
  tasks_completed: 3
  files_changed: 3
---

# Phase 1 Plan 01: Type Contracts and Infrastructure Foundation Summary

**One-liner:** PrdNode/PrdTree TypeScript types, Zustand store extended to v4 with migrate function, Express body limit raised to 10MB.

## What Was Built

This plan establishes the type contracts and infrastructure that every other Phase 1 plan depends on.

### Task 1 — `src/types/prdNode.ts` (created)
Pure type declaration file with four exports:
- `PrdNode` interface — 12 fields per D-04 spec: `id`, `parentId`, `label`, `summary`, `content`, `type`, `status`, `level`, `order`, `needsPolish`, `extractedFrom`, `techNotes`, `children`
- `PrdTree` — flat node map `Record<string, PrdNode>` for O(1) lookup
- `DecompositionStatus` — `'idle' | 'decomposing' | 'done' | 'error'`
- `DecompositionStep` — progress step with `label` and `status`

### Task 2 — `src/store/appStore.ts` (extended)
- Added import of `PrdNode`, `PrdTree`, `DecompositionStatus`, `DecompositionStep` from `../types/prdNode`
- Bumped `STORAGE_VERSION` from 3 to 4
- Added 4 new state fields: `prdTree`, `selectedNodeId`, `decompositionStatus`, `decompositionSteps`
- Added 7 new action methods: `setPrdTree`, `setSelectedNodeId`, `setDecompositionStatus`, `appendDecompositionStep`, `updateDecompositionStep`, `mergePartialTree`, `resetDecomposition`
- Added `migrate` function with explicit `version === 3` branch carrying forward `requirement`, `messages`, `latestRag`, `settings`; safe reset fallback for unknown versions
- Updated `partialize` to persist `prdTree` and `selectedNodeId` (decompositionStatus/Steps intentionally excluded — session-only)
- All existing fields and actions preserved unchanged

### Task 3 — `server/index.ts` (one-line change)
Changed `express.json({ limit: '1mb' })` to `express.json({ limit: '10mb' })` at line 543. This is INFRA-04 in its entirety. Server restart required for change to take effect.

## Verification

- `npx tsc --noEmit` — passed with zero errors
- `grep "STORAGE_VERSION = 4"` — confirmed
- `grep "limit: '10mb'"` — confirmed
- `grep "export interface PrdNode"` — confirmed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan creates pure type and infrastructure scaffolding; no UI rendering involved.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `45951e0` | feat(01-01): create PrdNode type definitions |
| 2 | `5d459bc` | feat(01-01): extend Zustand store with PrdTree slices v3->v4 migration |
| 3 | `f3c91ad` | fix(01-01): raise Express body limit to 10MB (INFRA-04) |

## Self-Check: PASSED
