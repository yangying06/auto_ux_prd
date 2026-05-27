---
phase: "04-export"
plan: "01"
subsystem: "export-backend"
tags: ["export", "zip", "fflate", "api", "server"]
dependency_graph:
  requires: []
  provides: ["POST /api/export-zip", "exportSpec()"]
  affects: ["server/index.ts", "src/lib/api.ts"]
tech_stack:
  added: ["fflate ^0.8.3"]
  patterns: ["synchronous zipSync for binary zip generation", "raw fetch() for binary blob response"]
key_files:
  created: []
  modified:
    - "server/index.ts"
    - "src/lib/api.ts"
    - "package.json"
decisions:
  - "Use res.end() not res.send() for binary zip to prevent Express v5 Content-Type override"
  - "Forward-slash path join (not path.join) to ensure cross-platform zip directory structure"
  - "sanitizeLabel preserves CJK characters via one-鿿 Unicode range since plain \\w misses Chinese in JS regex"
  - "exportSpec uses raw fetch() not requestJson helper (which calls .json() and would corrupt binary)"
  - "Export filters to completed leaf nodes only (children.length === 0 && status === 'done')"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-27T06:15:46Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 04 Plan 01: Export ZIP Backend Summary

**One-liner:** fflate-based zip endpoint that converts completed PrdTree leaf nodes to structured Markdown files, returned as binary zip; exportSpec() client function wraps raw fetch() to return a Blob.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install fflate and add POST /api/export-zip | edff3c5 | server/index.ts, package.json |
| 2 | Add exportSpec() to src/lib/api.ts | 4fe49dc | src/lib/api.ts |

## What Was Built

### server/index.ts — POST /api/export-zip

Three helper functions added before the route:

- `sanitizeLabel(label)` — strips non-word/non-CJK characters, collapses dashes, truncates to 40 chars. Preserves Chinese characters via the `一-鿿` Unicode range.
- `buildNodePath(nodeId, tree)` — walks ancestor chain to construct a hierarchical path like `ROOT-01/MOD-02/UI-03-label.md`. Uses `.join('/')` (never `path.join`) to guarantee forward-slash separators inside zip archives on all platforms.
- `generateMarkdown(node)` — produces structured Markdown with ID, type, status header, summary section, content section, and optional tech notes section.

The route itself:
- Validates `tree` body field presence
- Filters to leaf nodes (`children.length === 0`) that are `status === 'done'`
- Returns HTTP 400 if no completed leaf nodes found
- Builds `Record<string, Uint8Array>` files map, calls `zipSync(files)`
- Sends binary with `res.end(Buffer.from(zipped))` and correct Content-Type/Content-Disposition headers

### src/lib/api.ts — exportSpec()

- `export async function exportSpec(baseUrl, tree): Promise<Blob>`
- Uses raw `fetch()` POST (not `requestJson` helper which calls `.json()`)
- On non-ok response: attempts to parse JSON error body for a user-friendly message, falls back to HTTP status
- Returns `response.blob()` for binary zip content

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `fflate ^0.8.3` present in `package.json` dependencies (not devDependencies)
- `import { zipSync } from 'fflate'` confirmed in `server/index.ts`
- `app.post('/api/export-zip'` route confirmed
- `res.end(Buffer.from(zipped))` confirmed (not res.send)
- `join('/')` confirmed (not path.join)
- `npx tsc -p tsconfig.node.json --noEmit` exits 0
- `npx tsc -p tsconfig.app.json --noEmit` exits 0

## Known Stubs

None — this plan implements the complete backend layer. The export feature is not yet wired to a UI button (that is Plan 02's responsibility).

## Self-Check: PASSED

Files verified:
- FOUND: D:\learn\auto_ux_prd\server\index.ts (modified)
- FOUND: D:\learn\auto_ux_prd\src\lib\api.ts (modified)
- FOUND: D:\learn\auto_ux_prd\package.json (modified)

Commits verified:
- FOUND: edff3c5 (feat(04-01): add POST /api/export-zip endpoint with fflate zip generation)
- FOUND: 4fe49dc (feat(04-01): add exportSpec() client function to api.ts)
