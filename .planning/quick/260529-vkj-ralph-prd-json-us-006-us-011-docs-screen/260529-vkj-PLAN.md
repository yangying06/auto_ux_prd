---
quick_id: 260529-vkj
mode: quick-full
status: planned
must_haves:
  truths:
    - User correction is authoritative: US-006 through US-011 require real code verification, not just existing prd.json pass flags.
    - docs/screenshot-to-code-refactor-plan.md Phase 2/3/4 are the canonical scope: variant UI, selected-variant iteration, and SSE streaming.
    - Keep React + Vite + Zustand + Express; minimize changes and avoid speculative architecture.
  artifacts:
    - src/components/state/PrototypeVariants.tsx
    - src/components/map/ForgeChat.tsx
    - src/pages/ForgePage.tsx
    - src/lib/api.ts
    - src/lib/prototypeStream.ts
    - src/store/appStore.ts
    - src/types/prototypeVariant.ts
    - server/index.ts
    - server/prototypePrompts.ts
    - server/prototypePrompts.test.ts
    - prd.json
  key_links:
    - docs/screenshot-to-code-refactor-plan.md
    - prd.json
---

# Quick Task 260529-vkj Plan

## Objective
Complete and verify Ralph US-006 through US-011 against the iteration document: variant comparison UI, Forge preview integration, selected-variant iteration, server SSE streaming, client streaming rendering, and prd.json status updates.

## Task 1 — Verify and complete variant model/UI integration

files:
- src/types/prototypeVariant.ts
- src/store/appStore.ts
- src/components/state/PrototypeVariants.tsx
- src/components/map/ForgeChat.tsx
- src/pages/ForgePage.tsx

action:
- Add per-variant iteration history to PrototypeVariant.
- Ensure the grid supports complete/streaming/error states, Alt selection, and selected highlight.
- Ensure Forge preview can show the grid, switch to selected preview, and route iteration commands to the selected variant.

done:
- US-006 and US-007 criteria are satisfied by actual mounted UI and store behavior.

verify:
- npm run typecheck
- npm run build

## Task 2 — Implement selected-variant iteration and server/client SSE streaming

files:
- server/index.ts
- server/prototypePrompts.ts
- server/prototypePrompts.test.ts
- src/lib/api.ts
- src/lib/prototypeStream.ts
- src/pages/ForgePage.tsx
- src/store/appStore.ts

action:
- Make update requests default to 2 variants and include/replay per-variant instruction history.
- Keep non-streaming JSON path available.
- Add POST SSE endpoint behavior for prototype generation that emits setCode, variantComplete, and variantError events per variant.
- Add a client stream helper and wire ForgePage to initialize streaming variants, update html as chunks arrive, complete/error statuses, and update only the selected variant on iteration while pushing previous selected html into prototypeHistory.

done:
- US-008 through US-011 acceptance criteria are satisfied in code.

verify:
- npm run typecheck:server
- npx tsx server/prototypePrompts.test.ts
- npm run typecheck
- npm run build

## Task 3 — Update Ralph/GSD records

files:
- prd.json
- .planning/STATE.md
- .planning/quick/260529-vkj-ralph-prd-json-us-006-us-011-docs-screen/260529-vkj-SUMMARY.md
- .planning/quick/260529-vkj-ralph-prd-json-us-006-us-011-docs-screen/260529-vkj-VERIFICATION.md

action:
- Update US-006 through US-011 passes/notes based on actual implementation and verification.
- Create quick task summary and verification report.
- Update STATE.md quick task table and last activity.

done:
- Ralph workflow shows the six stories completed with notes.
- GSD quick task artifacts exist.

verify:
- git diff --stat
- npm run typecheck && npm run typecheck:server && npx tsx server/prototypePrompts.test.ts && npm run build
