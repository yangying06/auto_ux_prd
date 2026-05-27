# Phase 4: Export - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 04-export
**Mode:** Auto (user requested no interruptions — Claude selected recommended defaults)
**Areas discussed:** Zip delivery, Spec doc format, Export gate/button placement, Zip package

---

## Zip Delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side zip → binary HTTP response | Server generates zip, sends as application/zip; client downloads via Blob URL | ✓ |
| Client-side zip (jszip/fflate on frontend) | Browser assembles zip without server | |
| Server generates to disk → signed URL | More complex, not needed for single-user | |

**Auto-selected:** Server-side zip — consistent with existing server-heavy architecture; Blob URL works in both web and Tauri webview without extra client deps.

---

## Spec Doc Format

| Option | Description | Selected |
|--------|-------------|----------|
| Structured template from PrdNode fields | Fast, no AI calls, uses label/summary/content/techNotes | ✓ |
| AI-generated per node (Claude) | Higher quality but N API calls, slow, expensive | |
| Hybrid (template + AI summary if chat history exists) | More complex, nodeChats is session-only so unreliable | |

**Auto-selected:** Structured template — nodeChats is session-only and may be gone if user reloaded; node data is the authoritative source after forge polishing.

---

## Export Gate & Button Placement

| Option | Description | Selected |
|--------|-------------|----------|
| TopAppBar button (disabled until all leaves done) | In existing header, globally accessible in map view | ✓ |
| Floating action button on map canvas | More intrusive, harder to implement with existing layout | |
| TreeSummary export button (after decomposition) | Too early in flow, wrong phase | |

**Auto-selected:** TopAppBar — existing component, right side button pattern already established with "Upload PRD" button.

---

## Zip Package

| Option | Description | Selected |
|--------|-------------|----------|
| fflate | Pure JS, ~7KB, zero deps, Node.js + browser compatible | ✓ |
| archiver | More mature, Node.js only, heavier | |
| jszip | Browser + Node, larger bundle (~100KB) | |
| Node.js built-in (zlib) | Cannot create ZIP format natively (only gzip/deflate) | |

**Auto-selected:** fflate — smallest footprint, pure JS, sufficient for the use case.

---

## Claude's Discretion

- Error handling UX when export fails
- Progress/loading feedback during zip generation
- Success notification after download initiates

## Deferred Ideas

- Tauri file system save dialog for zip → v2
- AI-generated spec documents → v2
- Partial/selective export → v2
- Per-node generation progress → v2
