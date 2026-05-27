---
phase: 03-deep-forge
plan: 02
status: complete
wave: 1
completed: 2026-05-27
---

# Summary: ForgeNodePanel and ForgeChat Components

## One-liner
Created two presentational components for the Deep Forge view: ForgeNodePanel (left panel, read-only node details) and ForgeChat (right panel, AI chat + confirm button) — both props-only, no store imports.

## What was built
- **`src/components/map/ForgeNodePanel.tsx`** (new) — read-only node detail panel:
  - Type badge (module/feature/ui with color variants), ID badge, title h2
  - Summary section, conditional techNotes section, status badge (待处理/已完成)
  - Fixed width 360px, bg-surface-container, border-r, overflow-y-auto
- **`src/components/map/ForgeChat.tsx`** (new) — chat panel:
  - Message list: user bubbles (right, bg-secondary-container) + assistant bubbles (left, bg-surface-container + animate-fade-in)
  - Auto-scroll to latest message via messagesEndRef
  - Internal state: draft, isSending, error (all local useState — not props)
  - Loading indicator: three bouncing dots with staggered animation delays
  - Error banner: dismissible red banner on API failure
  - Textarea: Enter-to-send (Shift+Enter for newline), disabled while sending
  - Confirm Complete button: always visible, active-glow + bg-tertiary-container when nodeComplete=true, dim when false
  - Send button + Back button (returns via onBack prop)

## Key decisions applied
- D-08/D-10: Confirm button always visible; active-glow when nodeComplete=true
- D-17: ForgeChat manages isSending/error internally; onSend is async (ForgePage handles store writes)
- D-18: ForgeNodePanel is purely read-only display
- FORG-02: Neither component imports from appStore

## Verification
- `npx tsc -p tsconfig.app.json --noEmit` exits 0
- No `import.*appStore` in either file
- `onConfirm` wired to Confirm button onClick
- `active-glow` in nodeComplete=true class string
- `isSending` is local useState (not a prop)
