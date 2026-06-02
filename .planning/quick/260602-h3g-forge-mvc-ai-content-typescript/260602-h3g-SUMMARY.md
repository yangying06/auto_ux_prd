# Quick Task 260602-h3g Summary

## Result

Implemented the requested page polishing and document handling adjustments:

- Only pending page nodes show the “待打磨” badge and expose Forge entry.
- Double-clicking MVC/non-page nodes now selects them instead of navigating to Forge.
- Preview drawer editing now directly edits the selected node `content` via a textarea.
- “打开文档” now exports the selected node as standalone Markdown, independent of full export state.
- Forge AI receives MVC child context for page nodes, while the left preview remains the page node itself.

## Files Changed

- [NodeCard.tsx](../../../src/components/map/NodeCard.tsx)
- [PreviewDrawer.tsx](../../../src/components/map/PreviewDrawer.tsx)
- [MapPage.tsx](../../../src/pages/MapPage.tsx)
- [ForgePage.tsx](../../../src/pages/ForgePage.tsx)
- [appStore.ts](../../../src/store/appStore.ts)
- [api.ts](../../../src/lib/api.ts)
- [server/index.ts](../../../server/index.ts)
- [.planning/STATE.md](../../STATE.md)

## Verification

- `npm run typecheck` passed.

## Commit

Not committed; repository already contains unrelated uncommitted work, so changes were left in the working tree for review.
