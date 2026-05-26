# Phase 1: Foundation & Pipeline - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can upload a PRD Markdown file, watch AI progressively decompose it into a tree structure (level by level), and see the complete tree stored in the app. Includes router infrastructure for navigating between map and forge views.

</domain>

<decisions>
## Implementation Decisions

### Routing
- **D-01:** Use wouter with hash mode for routing. Two routes: `#/` (map view) and `#/forge/:nodeId` (forge view). Chosen for: 1.3kB size, hash routing works in Tauri without server rewrites, simple API (useRoute/useLocation).

### Upload & Decomposition UX
- **D-02:** Landing page flow: App opens to a landing page with centered upload card (drag-drop zone). After upload, the landing page transitions in-place to show decomposition progress. After completion, auto-navigates to map view.
- **D-03:** Decomposition uses progressive multi-step approach: Server calls Claude multiple times (first decompose L1, then expand each branch). Each step returns partial results, frontend renders the tree growing incrementally.

### Data Model
- **D-04:** PrdNode type includes: `id`, `parentId`, `label`, `summary`, `content` (full extracted text), `type` (module|feature|ui), `status` (pending|done), `children[]` (IDs), `level` (depth), `order` (sort position), `extractedFrom` (source text range), `techNotes`, `needsPolish` (boolean, AI-determined).
- **D-05:** AI marks each node with `needsPolish: boolean` during decomposition. Only nodes with `needsPolish: true` require Deep Forge polishing. This is not strictly leaf-only — AI decides based on whether the node describes a UI interaction.

### Progress Feedback
- **D-06:** Server decomposes in steps (L1 first, then each branch). Each step returns partial tree data. Frontend renders the tree growing level by level, giving users real-time feedback during the 10-30s process.

### Claude's Discretion
- Landing page visual design — as long as it fits the Forge Blueprint dark theme design system
- Exact decomposition prompt engineering — the schema is defined, the prompt strategy is up to implementation
- Error state design for failed uploads or decomposition

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design System
- `stitch/main/Image 3.markdown` — Forge Blueprint design system specification (colors, typography, spacing, components)
- `stitch/main/Image 2.html` — Map view design mockup (upload button in top bar, node layout, preview drawer)

### Existing Architecture
- `.planning/codebase/ARCHITECTURE.md` — Current component tree, data flow, Express proxy patterns
- `.planning/codebase/STACK.md` — Current tech stack with versions
- `.planning/codebase/CONCERNS.md` — Known issues (body limit, localStorage quota, no tests)

### Research
- `.planning/research/STACK.md` — Library recommendations (markmap, wouter, fflate)
- `.planning/research/ARCHITECTURE.md` — Recommended component boundaries and build order
- `.planning/research/PITFALLS.md` — Critical pitfalls (React/D3 conflict, AI JSON instability, localStorage quota)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/api.ts` — HTTP client pattern for Express proxy calls. Extend for new endpoints.
- `src/store/appStore.ts` — Zustand persist pattern with partialize. Add new slices alongside existing.
- `server/index.ts` — Claude tool-use loop already implemented (`runClaudeRequirementLoop`). Adapt for decomposition.
- `src/types/uxRequirement.ts` — Type definition pattern. Use same approach for PrdNode types.

### Established Patterns
- State management: Single Zustand store with persist middleware, storage version tracking
- API calls: Frontend POSTs to Express proxy, proxy calls Claude, returns normalized response
- Type safety: TypeScript strict mode, interfaces in `src/types/`

### Integration Points
- `src/App.tsx` — Currently renders AppShell directly. Needs router wrapper.
- `server/index.ts` line 543 — `express.json({ limit: '1mb' })` must change to `'10mb'`
- `src/store/appStore.ts` line 21 — `STORAGE_VERSION = 3` must bump to 4 with migrate function

</code_context>

<specifics>
## Specific Ideas

- User mentioned 飞书CLI结构 as reference for decomposition hierarchy (by function/discipline)
- Progressive tree rendering — user explicitly wants to see the tree "grow" during decomposition, not just a loading spinner
- The map view (Phase 2) will use markmap, so the tree data must be convertible to markmap's expected format

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-pipeline*
*Context gathered: 2026-05-26*
