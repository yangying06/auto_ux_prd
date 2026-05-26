# Feature Landscape

**Domain:** PRD document decomposition + interactive mindmap + per-node AI chat spec tool
**Project:** GameUX PromptForge — Map milestone
**Researched:** 2026-05-26
**Confidence:** MEDIUM (design mockups as primary source; web search unavailable; domain knowledge HIGH confidence)

---

## Table Stakes

Features users expect when they see a "document to mindmap" tool. Missing any of these and the product feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Upload a Markdown file | Entry point — nothing works without it | Low | Express body limit must be raised from 1MB; PRDs can be 50–200KB |
| AI parses doc and produces a tree | Core value prop; users see it demoed and expect it to just work | Medium | Prompt design is the hard part; JSON schema output needed for reliable parsing |
| Tree rendered as visible mindmap | "Mindmap tool" → must show a mindmap | Medium | markmap handles SVG rendering; custom node styles sit on top |
| Nodes show status (unprocessed / done) | Progress feedback; users need to know what's left | Low | Two states minimum: "To Process" (orange) and "Generated" (green), per design mockup |
| Click a node to see its content | Standard mindmap interaction; users expect inspect-on-click | Low | Right-side drawer from design mockup; shows extracted text context for that node |
| Navigate from map to a per-node editor | The purpose of the map is to select a node to work on | Low | Route/view switch; "Enter Deep Forge" CTA per mockup |
| Zoom and pan on the map canvas | Any non-trivial tree overflows the screen | Low | markmap provides this natively; zoom in/out/fit controls in design |
| Node state persists between sessions | Users don't finish in one sitting | Medium | localStorage first (per PROJECT.md decision), then Tauri FS |
| Per-node independent chat history | Nodes are separate work units; context bleed between nodes ruins AI quality | Medium | Each nodeId maps to its own message array in Zustand |
| Export finished spec as zip | Deliverable — the product's output | Medium | One Markdown file per completed leaf node, zipped; existing `download.ts` to extend |

---

## Differentiators

Features that set this specific tool apart. Users don't demand these out of the box, but they create a "this was built for me" feeling for game UX designers.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI decomposes by functional module, not just heading depth | Generic heading-based splits produce noise; a game PRD has modules (Pyramid Lottery, Caishen Drop) that cross heading levels | High | Requires a system prompt that understands game design vocabulary; tested iteratively |
| Hover preview of node content without opening the drawer | Quick scan of the whole map without losing overview; XMind and Notion don't do this for AI-structured content | Low | `line-clamp-2` excerpt on hover, per design mockup — already in the HTML spec |
| Node type badges (ROOT / MODULE / LEAF) | Structural clarity; users understand hierarchy at a glance without reading labels | Low | Design mockup already specifies: "ROOT NODE", "MODULE", and leaf cards with IDs |
| AI suggests completion + user confirms | Prevents false-positive "done" states; AI can be wrong about completeness | Medium | Two-step: AI emits a "suggest complete" signal; user clicks Confirm; node turns green |
| Node ID system (PL-01, CE-04) | Traceability — devs can reference spec items in tickets and commits | Low | Generated during AI decomposition; stored with node data |
| Progress indicator across all nodes | "60% done" at the map level keeps users motivated; generic mindmap tools don't do this | Low | count(done nodes) / count(leaf nodes); shown in top bar per design mockup |
| "Enter Deep Forge" navigation from preview drawer | Seamless transition from map overview to deep editing without losing context of which node you're working on | Low | Route param carries nodeId; Forge pre-loads that node's chat history |
| Cocos RAG context auto-applied per node | Game-engine-specific suggestions appear inline without user asking | High | Existing RAG integration; must scope retrieval to each node's content rather than global |
| Export blocked until all nodes complete | Forces completeness before delivery; prevents partial spec hand-offs | Low | Export button disabled with tooltip "Complete red nodes first", per design mockup |

---

## Anti-Features

Things to deliberately not build in this milestone. Each has a reason and a "what to do instead."

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Manual node creation / editing in the map | Adds drag-and-drop complexity; scope creep; the tree is AI-generated and should remain authoritative | Let AI regenerate the tree if the structure is wrong; the editing happens in Deep Forge per node |
| Multi-document management (tabs, project switcher) | Out of scope per PROJECT.md; doubles state management complexity for marginal MVP value | Single document mode; user uploads a new file to replace the current one |
| Real-time collaboration / multi-user | Out of scope per PROJECT.md; requires backend WebSocket infrastructure | Single-user desktop tool |
| PDF upload / automatic PDF-to-Markdown conversion | marker integration deferred per PROJECT.md; adds a heavy dependency | User pre-processes to Markdown; show a clear "Please upload .md file" instruction |
| Mindmap editing (drag nodes, rearrange) | Pure rendering mode is significantly simpler; rearranging a tree doesn't change the spec content | Use the Deep Forge chat to restructure content within a node |
| Non-UI nodes get the full polishing flow | Only UI interaction nodes have the four-slot UX spec format (trigger, sequence, assets, engine); other nodes are informational | Mark non-UI nodes as "Reference Only" without the Forge entry point; include their text in export but don't require completion |
| Auto-save to cloud / sync | Not a SaaS product; Tauri FS handles local persistence | localStorage → Tauri FS path, per existing PROJECT.md decision |
| Mindmap layout algorithm customization | Users don't need to choose between radial/tree/fishbone; one good layout is better than options | Fixed horizontal tree layout matching the design mockup |
| Undo/redo for node state changes | Complex state history management; PRD-to-spec work is forward-only | Provide a "Reset node" option to clear a node back to unprocessed; no full undo stack |

---

## Feature Dependencies

```
Upload MD file
  └→ AI decomposition to tree JSON
       └→ markmap renders tree
            ├→ Node status badges (requires node state in store)
            ├→ Hover preview (requires node content in store)
            ├→ Click → right drawer (requires node content)
            │    └→ "Enter Deep Forge" CTA (requires node ID in route)
            │         └→ Per-node chat session (requires isolated chat history per nodeId)
            │              └→ AI suggest complete → user confirms → node marked done
            │                   └→ All nodes done → Export unlocked
            │                        └→ Export zip (requires per-node Markdown output)
            └→ Progress indicator (requires done/total node counts)

Node state persistence (localStorage) — required by all node interactions
Per-node chat history — required by Deep Forge; depends on node ID assignment from decomposition
Route system — required to navigate map ↔ Forge; no other feature works cross-view without it
```

---

## MVP Recommendation

**Prioritize (Phase 1 — Map View):**
1. File upload + AI decomposition → tree JSON stored in Zustand
2. markmap render with custom node styles (status badges, hover excerpt)
3. Right-side preview drawer (click to open, shows extracted content)
4. Node state persistence (localStorage)
5. Route system: `/map` ↔ `/forge/:nodeId`
6. Progress indicator (node count in top bar)

**Prioritize (Phase 2 — Forge Integration):**
7. Per-node isolated chat history
8. AI suggest-complete + user confirm flow
9. "Enter Deep Forge" navigation carrying nodeId context
10. Cocos RAG scoped to node content

**Prioritize (Phase 3 — Export):**
11. Export zip: collect all completed nodes' Markdown output
12. Export unlock gate (all nodes done)

**Defer to post-MVP:**
- Non-UI node "Reference Only" treatment (mark as skipped, include in export, no Forge)
- Node ID system in export filenames (nice-to-have for traceability)
- Migrate localStorage to Tauri FS (only when shipping as desktop app)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Table stakes list | HIGH | Derived directly from design mockups (stitch/main/ HTML) and PROJECT.md Active requirements |
| Differentiators | MEDIUM | Design mockup confirms visual patterns; AI decomposition quality is runtime-dependent |
| Anti-features | HIGH | Explicitly confirmed by PROJECT.md Out of Scope section; no web search needed |
| Feature dependencies | HIGH | Logical analysis from existing codebase and stated requirements; no external sources needed |
| Complexity ratings | MEDIUM | Based on existing codebase state (no router, no per-node history, body limit issue) |

---

## Sources

- `stitch/main/Image 2.html` — Map view design mockup (HIGH confidence; primary design spec)
- `stitch/xiangqing/Image 2.html` — Deep Forge / per-node editing design mockup (HIGH confidence)
- `.planning/PROJECT.md` — Requirements, decisions, out-of-scope list (HIGH confidence; project authority)
- `src/store/appStore.ts` + `src/types/uxRequirement.ts` — Existing state model (HIGH confidence; ground truth)
- Domain knowledge: markmap API, XMind/Miro/Notion mindmap conventions, AI document decomposition tools (MEDIUM confidence; training data August 2025; web verification unavailable)
