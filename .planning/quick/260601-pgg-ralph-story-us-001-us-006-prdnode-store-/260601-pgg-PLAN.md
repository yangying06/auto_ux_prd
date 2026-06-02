---
phase: quick-260601-pgg-ralph-page-level-mindmap
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - prd.json
  - progress.txt
  - src/types/prdNode.ts
  - src/store/appStore.ts
  - src/lib/api.ts
  - src/pages/MapPage.tsx
  - src/pages/ForgePage.tsx
  - src/components/map/TreeCanvas.tsx
  - src/components/map/NodeCard.tsx
  - src/components/map/PreviewDrawer.tsx
  - src/components/map/DocumentPreview.tsx
  - src/components/map/MapAdjustmentPanel.tsx
  - server/index.ts
autonomous: true
requirements:
  - US-001
  - US-002
  - US-003
  - US-004
  - US-005
  - US-006
must_haves:
  truths:
    - "用户导入 PRD 后看到的是页面/屏幕级节点，而不是过度展开的控件或内部细节树。"
    - "页面节点以待打磨状态显示，单个页面可独立进入 Forge 打磨并完成为已确认状态。"
    - "用户可在导图页创建、编辑、删除页面节点，并通过本地代理打开生成的页面 spec 文档。"
    - "左侧 AI 调整对话只返回可审阅操作建议；用户确认前导图不发生任何变更。"
    - "导出的 spec 输出按页面拆成多个 Markdown 文件，并且打开文档接口拒绝路径穿越和任意本地路径。"
  artifacts:
    - path: "src/types/prdNode.ts"
      provides: "页面级 PrdNode 字段、pending_refine 状态、跨页面引用和 AI 调整操作类型"
    - path: "src/store/appStore.ts"
      provides: "页面节点增删改、引用维护、AI 操作确认应用、文档路径回写"
    - path: "src/components/map/MapAdjustmentPanel.tsx"
      provides: "导图左侧 AI 调整对话与 confirm-before-apply 操作审阅"
    - path: "server/index.ts"
      provides: "页面级拆分 prompt/parser、map-adjust API、安全 spec 文件夹导出、安全 open-doc API"
    - path: "prd.json"
      provides: "US-001..US-006 pass 状态和验证 notes"
    - path: "progress.txt"
      provides: "本次 Ralph story 执行和验证记录"
  key_links:
    - from: "src/pages/MapPage.tsx"
      to: "src/store/appStore.ts"
      via: "create/update/delete/apply map operations callbacks"
      pattern: "createPageNode|updateNode|deleteNode|applyMapAdjustmentOperations"
    - from: "src/components/map/MapAdjustmentPanel.tsx"
      to: "server/index.ts /api/map-adjust"
      via: "requestMapAdjustment() returning pending operations only"
      pattern: "requestMapAdjustment"
    - from: "src/components/map/PreviewDrawer.tsx"
      to: "server/index.ts /api/open-doc"
      via: "openGeneratedDoc() after export folder path exists"
      pattern: "openGeneratedDoc"
    - from: "src/pages/ForgePage.tsx"
      to: "src/store/appStore.ts"
      via: "nodeComplete updates only current node to done"
      pattern: "updateNodeStatus\\(nodeId, 'done'\\)"
    - from: "server/index.ts"
      to: "generated/specs"
      via: "path.resolve allowlist under generated spec root"
      pattern: "SPEC_EXPORT_ROOT|resolveGeneratedSpecPath"
---

<objective>
Implement Ralph stories US-001 through US-006 for page-level mind map decomposition and refinement.

Purpose: shift the product from document-package decomposition to screen/page-level spec authoring, while preserving the existing React + Vite + Tailwind + Zustand + Express stack and avoiding new dependencies.

Output: page-aware node model/store operations, map UI node management, left-side AI adjustment chat with explicit confirmation, page-level decomposition prompt/parser, one-page-at-a-time refinement completion, generated spec folder export, safe local document opening, and story pass tracking.
</objective>

<execution_context>
Use the existing GSD quick workflow context. Do not modify ROADMAP.md. Do not add dependencies unless a required behavior is impossible with the current stack.

Discovery level: Level 0. The work extends existing Zustand, React, Tailwind, Express, Anthropic SDK, and fflate patterns already present in the codebase.
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@prd.json
@src/types/prdNode.ts
@src/store/appStore.ts
@src/pages/MapPage.tsx
@src/components/map/TreeCanvas.tsx
@src/components/map/NodeCard.tsx
@src/components/map/PreviewDrawer.tsx
@src/components/map/DocumentPreview.tsx
@src/pages/ForgePage.tsx
@src/lib/api.ts
@server/index.ts

<interfaces>
Current contracts to preserve and extend:

From src/types/prdNode.ts:
```ts
export interface PrdNode {
  id: string
  parentId: string | null
  label: string
  summary: string
  content: string
  type: 'module' | 'feature' | 'ui'
  status: 'pending' | 'done'
  level: number
  order: number
  needsPolish: boolean
  extractedFrom: string | null
  techNotes: string | null
  children: string[]
  docPath?: string | null
  audience?: PrdNodeAudience | null
  handoffGoal?: string | null
  qualityGate?: string | null
}
```

From src/store/appStore.ts:
```ts
setPrdTree(tree: PrdTree): void
setSelectedNodeId(id: string | null): void
applyNodePolish(nodeId: string, patch: { summary?: string | null; content?: string | null; techNotes?: string | null }): void
updateNodeStatus(nodeId: string, status: PrdNode['status']): void
mergePartialTree(nodes: Record<string, PrdNode>): void
resetDecomposition(): void
```

From src/lib/api.ts:
```ts
startDecomposition(baseUrl: string, mdText: string): Promise<{ sessionId: string }>
pollDecomposition(baseUrl: string, sessionId: string): Promise<DecompositionPollResult>
sendNodeChatMessage(baseUrl: string, nodeId: string, messages: ChatMessage[], tree: Record<string, PrdNode>): Promise<NodeChatResponse>
exportSpec(baseUrl: string, tree: Record<string, PrdNode>): Promise<Blob>
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend page-level node contracts, store mutations, and decomposition output</name>
  <files>src/types/prdNode.ts, src/store/appStore.ts, server/index.ts</files>
  <action>
    Implement US-001 and US-004 foundations.

    1. In `src/types/prdNode.ts`, extend the model without breaking persisted trees:
       - Add `type: 'page'` as the page/screen node type while preserving existing `'module' | 'feature' | 'ui'` values.
       - Add `status: 'pending_refine'` while preserving existing `'pending' | 'done'` values. Treat old `pending` data as valid for backward compatibility.
       - Add optional cross-page reference support, for example `references?: PrdNodeReference[]`, where each reference stores `targetNodeId`, `label`, and optional `reason`/`sourceNodeId` text. Keep this simple; do not create a separate graph subsystem.
       - Add operation types for map adjustment suggestions: `create_node`, `delete_node`, `update_node`, `move_content`, `add_reference`. These are data contracts only; mutation happens in the store after user confirmation.

    2. In `src/store/appStore.ts`, add minimal page-node operations:
       - `createPageNode(input)` creates a `type: 'page'`, `status: 'pending_refine'`, `needsPolish: true` node with a generated stable-enough ID, correct `parentId`, `level`, `order`, `children: []`, and starter Chinese `summary/content` that says the page is waiting for refinement.
       - `updateNode(nodeId, patch)` edits label/summary/content/docPath/references/techNotes/status/type/audience/handoffGoal/qualityGate only when the node exists.
       - `deleteNode(nodeId)` removes the selected node and descendants, removes those IDs from all parent `children`, and removes cross-page references pointing at deleted IDs. Do not delete unrelated nodes.
       - `applyMapAdjustmentOperations(operations)` applies only the typed operations after confirmation. New/updated page nodes default to `pending_refine` unless the operation explicitly sets `status: 'done'`.
       - `setNodeDocPath(nodeId, docPath)` or equivalent lightweight update for export/open integration.
       - Reuse `rebuildPrdTreeLinks()` after structural mutations. Avoid speculative store refactors.

    3. In `server/index.ts`, change decomposition from document-package oriented to page/screen oriented:
       - Update tool schemas to accept `type: 'page'`, `status: 'pending_refine'`, and optional `references`.
       - Update prompts to explicitly identify pages/screens such as `主界面`, `规则页`, `帮助页`, `排行榜`; attach page internals to `content`; represent cross-page content as `references`; and state that page internals belong in the right detail/document view, not as excessive child nodes.
       - Normalize AI output so page nodes get `status: 'pending_refine'`, `needsPolish: true`, `docPath` derived safely when absent, and references normalized to valid simple objects.
       - Parser validation must reject or error clearly on malformed page/reference shapes rather than silently creating arbitrary structures. Existing old trees from localStorage must still load because frontend normalizes unknown/missing optional fields safely.
       - Update mock decomposition nodes to include page examples so browser verification can run without Anthropic when `MOCK_DECOMPOSE=true`.
  </action>
  <verify>
    <automated>npm run typecheck:server</automated>
    <automated>npm run typecheck</automated>
  </verify>
  <done>
    US-001 and US-004 model/parser criteria are implemented: page-level nodes exist, `pending_refine` is supported and displayed downstream, references are modeled, old data remains loadable, AI decomposition asks for page-level output, and TypeScript passes.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add map node management and confirm-before-apply AI adjustment UI</name>
  <files>src/lib/api.ts, src/pages/MapPage.tsx, src/components/map/TreeCanvas.tsx, src/components/map/NodeCard.tsx, src/components/map/PreviewDrawer.tsx, src/components/map/DocumentPreview.tsx, src/components/map/MapAdjustmentPanel.tsx, server/index.ts</files>
  <action>
    Implement US-002 and US-003 on top of Task 1 contracts.

    1. Add `src/components/map/MapAdjustmentPanel.tsx` as the left-side map AI adjustment panel:
       - Use existing Tailwind/Forge Blueprint styling; no new dependency.
       - Keep panel state local to `MapPage` unless persistence is already needed by existing store patterns.
       - Accept user text describing split issues.
       - Call a new `requestMapAdjustment(baseUrl, messages, tree)` helper in `src/lib/api.ts`.
       - Render the AI reply plus structured operation suggestions with clear Chinese labels.
       - Provide `确认应用` and `取消` controls. Confirm calls `applyMapAdjustmentOperations`; cancel clears pending suggestions and leaves `prdTree` unchanged.
       - Never mutate the map from the API response itself. This is the critical US-003 confirm-before-apply requirement.

    2. Add a new `/api/map-adjust` route in `server/index.ts`:
       - Request body: current messages and current tree.
       - Response shape: `{ reply: string, operations: MapAdjustmentOperation[] }`.
       - Prompt the model to suggest only typed operations: `create_node`, `delete_node`, `update_node`, `move_content`, `add_reference`.
       - Validate operations server-side: require operation type, constrain strings, reject arbitrary unknown fields or malformed IDs/targets, and return an empty operations array with a readable reply if validation fails.
       - The route must not mutate server-side state; frontend confirmation is the only mutation path.

    3. Wire map UI operations without leaving the map context:
       - In `MapPage`, render a left sidebar with `MapAdjustmentPanel`, the central `TreeCanvas`, and the existing right `PreviewDrawer`.
       - Add a clear `新建页面` affordance. It may use `window.prompt` for the title to keep scope small; create under the selected node when appropriate, otherwise at root level.
       - In `PreviewDrawer`, add compact actions for selected page nodes: edit title/summary/core metadata, delete with explicit `window.confirm`, open generated document, and enter Forge. Prompt-based editing is acceptable; do not introduce a complex form unless needed.
       - In `NodeCard`, display `pending_refine` and old `pending + needsPolish` as `待打磨`; display completed nodes as `已确认`; use page-oriented labels/icons for `type: 'page'`.
       - In `TreeCanvas`, update layer labels away from document-package wording toward page-level wording, e.g. PRD / 页面 / 子页面.
       - In `DocumentPreview`, render `references` as a cross-page reference section and include references in generated markdown previews.
       - Ensure create, update, delete, and AI-confirm operations preserve `pending_refine` for new/changed pages unless explicitly completed.
  </action>
  <verify>
    <automated>npm run typecheck</automated>
    <automated>npm run build</automated>
    <manual>Run `npm run dev`, enter the map with `MOCK_DECOMPOSE=true` or an existing tree, then verify: create a page, edit title/summary, delete with confirmation, send an AI adjustment request, cancel once and confirm once, and confirm the tree only changes after confirmation.</manual>
  </verify>
  <done>
    US-002 and US-003 UI criteria are implemented: map-level create/edit/delete/open affordances exist, left AI chat returns reviewable operations, cancel leaves the tree unchanged, confirm applies typed operations, and browser verification covers the flows.
  </done>
</task>

<task type="auto">
  <name>Task 3: Finish page refinement, generated spec folder export, safe open-doc, and story tracking</name>
  <files>src/lib/api.ts, src/pages/MapPage.tsx, src/pages/ForgePage.tsx, src/components/map/PreviewDrawer.tsx, src/components/map/DocumentPreview.tsx, server/index.ts, prd.json, progress.txt</files>
  <action>
    Implement US-005 and US-006, then update tracking only after verification passes.

    1. Refine one page at a time in `ForgePage`:
       - When `sendNodeChatMessage` returns a `nodePatch`, continue applying it only to the current node.
       - When the response sets `nodeComplete: true`, set local `nodeComplete` and update only that node status to `done`. Do not mark sibling pages done.
       - Keep the existing manual `确认完成` path; it should still merge fallback polish content when needed and update only the current node.
       - Ensure returning to the map shows the refined page as completed while unrelated pages remain `待打磨`.

    2. Add generated spec folder export in `server/index.ts` while preserving safe path behavior:
       - Create a fixed allowlisted root such as `generated/specs` under the project directory. Define a single `SPEC_EXPORT_ROOT` constant.
       - Add shared helpers to generate page Markdown from page nodes, including refined `content` and cross-page `references`.
       - Add `POST /api/export-spec-folder` that writes one Markdown file per exportable page node to a generated folder under `SPEC_EXPORT_ROOT`, using sanitized filenames/relative paths only. Return `{ exportDir, documents: [{ nodeId, docPath }] }`.
       - Keep existing `/api/export-zip` working if currently used elsewhere, but the map export action should now create the folder output required by US-006 and update each node's `docPath` from the response.
       - Derived filenames must reject/neutralize traversal, Windows invalid filename characters, absolute paths, drive letters, and empty segments.

    3. Add safe local document open through the proxy:
       - Add `POST /api/open-doc` with body `{ docPath: string }`.
       - Resolve `docPath` only inside `SPEC_EXPORT_ROOT`; reject `..`, absolute paths, drive-letter paths, and any resolved path outside the root with 400/403.
       - If the file does not exist, return 404. Do not fall back to opening arbitrary user-provided paths.
       - Open with the OS default application only after the allowlist check passes (`start`/`explorer` on Windows, `open` on macOS, `xdg-open` on Linux). Pass the resolved file path as an argument, not as interpolated shell text.
       - In `src/lib/api.ts`, add `exportSpecFolder()` and `openGeneratedDoc()` helpers.
       - In `MapPage`/`PreviewDrawer`, make `打开文档` route through the proxy. If the selected page has no generated path yet, export/write the folder first, update node doc paths in the store, then call open-doc for that node.

    4. After all automated and browser verification passes, update tracking:
       - In `prd.json`, set `passes: true` for US-001 through US-006 and add concise Chinese `notes` describing verified behavior. Do not mark passes if any story verification failed.
       - Append a dated entry to `progress.txt` summarizing Ralph US-001..US-006 completion, verification commands, and any remaining caveats.
       - Do not modify `ROADMAP.md`.
  </action>
  <verify>
    <automated>npm run typecheck:server</automated>
    <automated>npm run typecheck</automated>
    <automated>npm run build</automated>
    <manual>Run `npm run dev`; verify one page can be refined to completed while another remains `待打磨`; export creates a generated spec folder with one Markdown file per page; opening a page document succeeds through the proxy.</manual>
    <manual>With the server running, POST `{"docPath":"../../package.json"}` to `/api/open-doc` and verify it is rejected; POST a valid returned generated docPath and verify it opens.</manual>
  </verify>
  <done>
    US-005 and US-006 are complete: one-page refinement updates only the active page, exported output is page-separated Markdown under an allowlisted generated specs directory, open-doc cannot escape that directory, and `prd.json`/`progress.txt` are updated only after verification succeeds.
  </done>
</task>

</tasks>

<dependency_graph>
Task 1 creates the contracts and parser behavior consumed by Tasks 2 and 3.
Task 2 depends on Task 1 store/types and creates UI/API wiring for map editing and AI operations.
Task 3 depends on Task 1 types/store and Task 2 open-document UI hooks; it finalizes Forge completion, export/open behavior, and story tracking.

Because `server/index.ts`, `src/lib/api.ts`, and `MapPage.tsx` are shared across tasks, execute sequentially rather than in parallel unless agents coordinate file ownership manually.
</dependency_graph>

<verification>
Required automated verification before marking `prd.json` passes:
1. `npm run typecheck:server`
2. `npm run typecheck`
3. `npm run build`

Required browser/dev verification:
1. Run `npm run dev`.
2. Use `MOCK_DECOMPOSE=true` if Anthropic credentials are unavailable.
3. Verify page-level decomposition reaches the map.
4. Verify create/edit/delete/open document flows.
5. Verify left AI adjustment suggestions do not mutate until confirmed.
6. Verify one page can be completed while another remains `待打磨`.
7. Verify generated spec folder contains one Markdown file per page.
8. Verify `/api/open-doc` rejects traversal/arbitrary local paths.
</verification>

<success_criteria>
- US-001 through US-006 acceptance criteria in `prd.json` are met.
- Existing persisted trees with old `pending` status and old `module|feature|ui` types still load without crashing.
- No new external dependencies are added.
- Frontend never accesses arbitrary local files directly; all document opening goes through the Express proxy.
- Express open-doc access is restricted to the generated spec directory.
- `npm run typecheck:server`, `npm run typecheck`, and `npm run build` pass.
- `prd.json` pass flags and `progress.txt` are updated only after verification passes.
</success_criteria>

<output>
After implementation, leave a concise execution note in `progress.txt` and do not create extra documentation files unless explicitly requested.
</output>
