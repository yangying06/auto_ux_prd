# Quick Task 260527-sl3: AI Prototype Integration - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Task Boundary

Implement the highest-ROI product integration path from `docs/ai-prototype-integration-proposal.md`: improve generated prototype robustness, make previews sandboxed, support conversational prototype iteration, preserve version history, and add a runnable-prototype validation exit via bolt.new.

</domain>

<decisions>
## Implementation Decisions

### Scope
- Implement proposal Phase 1, Phase 2 core iteration, Phase 3 bolt external validation, and lightweight version history now.
- Do not self-host bolt.diy or integrate prompt-optimizer code; those are higher-risk and outside the current React + Vite + Express app boundary.
- Avoid adding parser dependencies unless necessary; implement a small local HTML extraction/wrapping utility compatible with both browser and server.

### Prototype Generation
- Use create/update routing in `/api/prototype`: no current HTML means full creation; current HTML plus instruction means targeted iteration.
- Add an `edit_prototype` Claude tool for exact string replacement, with fallback to full HTML extraction when the model returns a whole document instead.
- Strengthen the prototype prompt with single-file, CDN-only, Tailwind-ready, no-build constraints.

### Preview And History
- Replace direct `srcDoc` rendering with a public sandbox host that receives hydrate messages and renders inside an isolated child frame.
- Keep a bounded prototype history in Zustand so users can restore prior rounds.
- Persist current prototype/history in the app store because version history is now an explicit feature.

### Validation Exit
- Add bolt.new prompt generation from both refined UX requirement state and exported PRD tree data.
- Open bolt.new with an encoded structured prompt, without embedding WebContainer or bolt.diy locally.

</decisions>

<specifics>
## Specific References

- `src/components/state/PrototypeBoard.tsx` currently renders `srcDoc` directly.
- `server/index.ts` owns `/api/prototype` and can route create/update centrally.
- `src/components/map/TopAppBar.tsx` is the export toolbar where the validation exit belongs for decomposed PRD flows.

</specifics>

<canonical_refs>
## Canonical References

- `docs/ai-prototype-integration-proposal.md`
- `AGENTS.md`
- `.planning/ROADMAP.md`

</canonical_refs>
