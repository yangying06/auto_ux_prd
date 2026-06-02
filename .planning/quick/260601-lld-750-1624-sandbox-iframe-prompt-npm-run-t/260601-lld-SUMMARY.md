---
phase: 260601-lld
plan: 01
subsystem: prototype-preview
tags: [sandbox, prototype, iframe, prompt, typecheck]

requires:
  - phase: quick
    provides: Existing PrototypeBoard and ForgeChat sandbox hydration flow
provides:
  - Fixed 750x1624 sandbox design canvas with viewport scaling
  - Prototype normalization CSS variables and no-scroll base style
  - Claude prototype create/update prompt size constraints
affects: [prototype-preview, deep-forge, visual-cabin]

tech-stack:
  added: []
  patterns:
    - Sandbox owns display scaling while generated HTML owns only inner prototype content

key-files:
  created: []
  modified:
    - public/sandbox.html
    - src/lib/prototypeUtils.ts
    - server/index.ts

key-decisions:
  - "Keep the sandbox responsible for 750x1624 canvas scaling instead of changing React preview frames."
  - "Keep the prompt size contract as literal 750×1624 text to avoid unused server imports."

patterns-established:
  - "Hydrated prototype HTML is displayed inside a fixed 750x1624 sandbox canvas scaled to the iframe viewport."

requirements-completed:
  - QUICK-260601-LLD

duration: 5min
completed: 2026-06-01
---

# Quick 260601-lld: Sandbox Iframe Prompt Summary

**750x1624 prototype sandbox canvas scaling with matching normalization and Claude prompt constraints**

## Performance

- **Duration:** 5 min
- **Completed:** 2026-06-01
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added a centered sandbox viewport and fixed 750x1624 canvas that scales to fit the iframe viewport without scrollbars.
- Preserved the existing `postMessage({ action: 'hydrate', html })` contract and inner iframe `sandbox="allow-scripts"` behavior.
- Exported prototype design-size constants and injected a minimal no-scroll CSS contract during prototype normalization.
- Updated create and update prototype prompts to require the 750x1624 canvas contract, no page scrolling, and no extra phone/browser shell.

## Files Created/Modified

- `public/sandbox.html` - Owns the fixed 750x1624 canvas and scales it to the sandbox iframe viewport.
- `src/lib/prototypeUtils.ts` - Exports design dimensions and injects the no-scroll prototype CSS contract.
- `server/index.ts` - Adds create/update prompt constraints for the 750x1624 prototype canvas.

## Issues Encountered

- Removed unused server-side prototype size imports/helper after a follow-up diagnostic check; prompts keep the literal `750×1624` contract text directly.

## Verification

- Sandbox contract check: passed.
- Prototype normalization and prompt contract check: passed.
- `npm run typecheck`: passed.
