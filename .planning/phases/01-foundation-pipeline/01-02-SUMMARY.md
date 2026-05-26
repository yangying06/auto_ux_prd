---
phase: 01-foundation-pipeline
plan: 02
subsystem: api
tags: [express, anthropic, tool-use, prd-decomposition, typescript]

# Dependency graph
requires:
  - phase: 01-foundation-pipeline plan 01
    provides: PrdNode type definition in src/types/prdNode.ts

provides:
  - POST /api/decompose/start — starts async PRD decomposition job, returns sessionId
  - GET /api/decompose/:sessionId — polls job status, returns nodes/status/currentStep
  - decomposePrdTool — Anthropic Tool definition forcing structured PrdNode output
  - normalizeDecompositionNodes — sanitizes malformed AI output, never throws
  - normalizeDecompositionTree — wraps normalizer, throws on empty result
  - runDecompositionJob — L1 decompose then sequential branch expand orchestrator

affects:
  - 01-03 (frontend store integration of prdTree from decomposition API)
  - 01-04 (markmap rendering consuming PrdTree from store)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Forced tool_choice: { type: 'tool', name: '...' } for structured AI output"
    - "Fire-and-forget async job with in-memory Map session store"
    - "Normalizer pattern: unknown input -> typed output, never throws"
    - "5-minute delayed session cleanup after completion"

key-files:
  created: []
  modified:
    - server/index.ts

key-decisions:
  - "In-memory Map session store is sufficient for single-user desktop app (no persistence needed)"
  - "Forced tool_choice ensures Claude always fills PrdNode schema (not autonomous tool selection)"
  - "normalizeDecompositionNodes returns [] on bad input so job orchestrator never crashes on malformed AI output"
  - "Branch expansion is sequential (not parallel) to avoid rate limiting and maintain step tracking clarity"

patterns-established:
  - "Pattern: All new helper functions placed above app.use(cors) block, all routes below it"
  - "Pattern: Return void res.status(N).json() for early returns in Express v5 handlers"

requirements-completed:
  - DCMP-01
  - DCMP-02
  - DCMP-03
  - DCMP-04

# Metrics
duration: 2min
completed: 2026-05-26
---

# Phase 01 Plan 02: Server-Side PRD Decomposition Pipeline Summary

**Express polling API + Claude forced-tool-use decomposition pipeline: POST /api/decompose/start and GET /api/decompose/:sessionId with PrdNode normalizer and multi-step L1+branch job orchestration**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-26T10:26:56Z
- **Completed:** 2026-05-26T10:29:09Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Added `decomposePrdTool` Anthropic Tool definition with complete PrdNode input_schema, using forced `tool_choice` to guarantee structured output
- Added `normalizeDecompositionNodes` and `normalizeDecompositionTree` with null-safe guards — bad AI output returns `[]` rather than throwing
- Added `runDecompositionJob` orchestrating L1 decompose then sequential branch expansion per L1 node
- Exposed two-endpoint polling API: POST starts job fire-and-forget, GET returns live status + accumulated nodes + cleanup scheduled after 5 min

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PrdNode types import and in-memory session store** - `77db084` (feat)
2. **Task 2: Add decomposePrdTool, normalizer functions, and Claude decompose calls** - `a568144` (feat)
3. **Task 3: Add POST /api/decompose/start and GET /api/decompose/:sessionId routes** - `9e00e5d` (feat)

## Files Created/Modified

- `server/index.ts` - Added PrdNode import, DecompositionSession interface, session Map, decomposePrdTool, normalizer functions, Claude call functions, job orchestrator, and two Express routes

## Decisions Made

- In-memory Map session store: single-user desktop app has no need for persistence between server restarts
- Forced tool_choice on both `decomposeL1` and `decomposeBranch` calls — Claude is not allowed to choose tools autonomously for this structured extraction task
- `normalizeDecompositionNodes` returns `[]` on any bad input (not throws) so `runDecompositionJob` error handling flows through the session `status: 'error'` path cleanly
- Sequential branch expansion (not concurrent) to avoid API rate limits and keep `currentStep` meaningful for the frontend progress display

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - `npx tsc --noEmit` passed cleanly after all insertions.

## User Setup Required

None - no external service configuration required beyond the existing `ANTHROPIC_API_KEY`.

## Next Phase Readiness

- Server decomposition pipeline is complete and ready for frontend integration
- Plan 03 can now wire the Zustand store to call POST /api/decompose/start and poll GET /api/decompose/:sessionId
- TypeScript compiles clean; no new dependencies added

---
*Phase: 01-foundation-pipeline*
*Completed: 2026-05-26*
