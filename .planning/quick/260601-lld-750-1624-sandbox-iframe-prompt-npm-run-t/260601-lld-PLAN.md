---
phase: 260601-lld
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - public/sandbox.html
  - src/lib/prototypeUtils.ts
  - server/index.ts
autonomous: true
requirements:
  - QUICK-260601-LLD
must_haves:
  truths:
    - "原型内容始终在 sandbox 提供的 750×1624 CSS px 设计画布中渲染。"
    - "无论 PrototypeBoard 或 PhonePrototypeFrame 的 iframe 实际显示尺寸如何，sandbox 都会把 750×1624 画布等比缩放到可视区域内，避免外层滚动条。"
    - "创建和迭代原型的 Claude prompt 都明确要求遵守 750×1624 尺寸契约，不再生成需要滚动查看的长页面或重复手机外壳。"
    - "改动保持小范围，不引入新依赖，不重构现有视觉舱/预览框 React 组件。"
  artifacts:
    - path: "public/sandbox.html"
      provides: "固定 750×1624 设计画布、iframe hydration、按 iframe viewport 等比缩放"
      contains: "DESIGN_WIDTH"
    - path: "src/lib/prototypeUtils.ts"
      provides: "原型 HTML 标准化时注入设计画布 CSS 契约"
      contains: "PROTOTYPE_DESIGN_WIDTH"
    - path: "server/index.ts"
      provides: "生成/迭代原型 prompt 的 750×1624 尺寸契约"
      contains: "750×1624"
  key_links:
    - from: "src/components/state/PrototypeBoard.tsx"
      to: "public/sandbox.html"
      via: "iframe src=\"/sandbox.html\" plus postMessage({ action: 'hydrate', html })"
      pattern: "postMessage\\(\\{ action: 'hydrate'"
    - from: "src/components/map/ForgeChat.tsx"
      to: "public/sandbox.html"
      via: "PhonePrototypeFrame iframe src=\"/sandbox.html\" plus hydrate message"
      pattern: "src=\"/sandbox.html\""
    - from: "server/index.ts"
      to: "src/lib/prototypeUtils.ts"
      via: "generated HTML is normalized before sandbox hydration"
      pattern: "normalizePrototypeHtml"
---

<objective>
实现原型预览尺寸适配修复：sandbox 拥有统一的 750×1624 设计画布，并根据 iframe 实际 viewport 自动等比缩放；生成的原型 HTML 被注入该画布中预览，避免生成内容依赖滚动条。

Purpose: 让 AI 生成的手机长屏原型在 PrototypeBoard 和对比视图中都以同一设计基准预览，不再因为 iframe 外壳尺寸变化而产生滚动或比例不一致。
Output: 更新后的 sandbox wrapper、原型 HTML 标准化尺寸契约、Claude 原型生成/迭代 prompt 尺寸约束。
</objective>

<execution_context>
@C:/Users/13760/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/13760/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@D:/learn/auto_ux_prd/.planning/STATE.md
@D:/learn/auto_ux_prd/CLAUDE.md
@D:/learn/auto_ux_prd/public/sandbox.html
@D:/learn/auto_ux_prd/src/lib/prototypeUtils.ts
@D:/learn/auto_ux_prd/server/index.ts
@D:/learn/auto_ux_prd/src/components/state/PrototypeBoard.tsx
@D:/learn/auto_ux_prd/src/components/map/ForgeChat.tsx

<interfaces>
<!-- Existing hydration contract to preserve. Do not rename this message shape. -->
PrototypeBoard and PhonePrototypeFrame both call:
```ts
iframeRef.current?.contentWindow?.postMessage({ action: 'hydrate', html: normalizedHtml }, '*')
```

public/sandbox.html currently accepts:
```js
if (!data || data.action !== 'hydrate' || typeof data.html !== 'string') return;
preview.srcdoc = data.html;
```

src/lib/prototypeUtils.ts currently exports:
```ts
export function normalizePrototypeHtml(raw: string): string
```

server/index.ts currently imports frontend prototype utilities:
```ts
import { applyPrototypeEdit, normalizePrototypeHtml } from '../src/lib/prototypeUtils'
```
</interfaces>

Notes:
- Keep changes surgical. Do not refactor `PrototypeBoard.tsx` or `ForgeChat.tsx` unless a direct typecheck failure requires a tiny compatibility fix.
- Do not add dependencies.
- Do not introduce a new React component or routing change.
- The sandbox, not generated prototype HTML, owns the design canvas and display scaling.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Make sandbox own and scale the 750×1624 design canvas</name>
  <files>public/sandbox.html</files>
  <action>
    Replace the full-window `#preview` iframe layout with a fixed design canvas inside the sandbox page:
    - Define `DESIGN_WIDTH = 750` and `DESIGN_HEIGHT = 1624` in the inline script.
    - Add a wrapper such as `#viewport` that fills the sandbox page (`100vw`/`100vh`), centers content, and keeps `overflow: hidden`.
    - Add a fixed-size `#canvas` of exactly `750px × 1624px` with `transform-origin: center center`.
    - Put the existing `#preview` iframe inside `#canvas`, sized exactly `750px × 1624px`; keep `sandbox="allow-scripts"` on the inner preview iframe.
    - Add a small `resizeCanvas()` function that computes `scale = Math.max(0.01, Math.min(window.innerWidth / 750, window.innerHeight / 1624))` and applies it to `#canvas` with `transform: scale(...)`.
    - Call `resizeCanvas()` on load and on `window.resize`.
    - Preserve the existing postMessage hydration contract: only accept `{ action: 'hydrate', html: string }`, then set `preview.srcdoc = data.html`.
    - Do not add scrollbars to the sandbox body, viewport, canvas, or preview iframe.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'); const html=fs.readFileSync('public/sandbox.html','utf8'); if(!/DESIGN_WIDTH\s*=\s*750/.test(html)) throw new Error('missing DESIGN_WIDTH=750'); if(!/DESIGN_HEIGHT\s*=\s*1624/.test(html)) throw new Error('missing DESIGN_HEIGHT=1624'); if(!/resizeCanvas/.test(html) || !/scale\(/.test(html)) throw new Error('missing scale resize'); if(!/action\s*!==\s*['\"]hydrate['\"]/.test(html) || !/srcdoc\s*=\s*data\.html/.test(html)) throw new Error('hydrate contract changed');"</automated>
  </verify>
  <done>`public/sandbox.html` renders hydrated prototype HTML through a 750×1624 iframe nested in a scaled canvas, and the hydration message contract remains unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Add the 750×1624 contract to normalization and prompts</name>
  <files>src/lib/prototypeUtils.ts, server/index.ts</files>
  <action>
    Update the prototype HTML and prompt contracts without changing API shapes:
    - In `src/lib/prototypeUtils.ts`, export `PROTOTYPE_DESIGN_WIDTH = 750` and `PROTOTYPE_DESIGN_HEIGHT = 1624` near the existing `TAILWIND_CDN` constant.
    - Extend the injected `baseStyle` so normalized prototype documents know the canvas contract, for example with `:root { --prototype-design-width: 750px; --prototype-design-height: 1624px; }` plus `html, body { margin: 0; width: 100%; min-height: 100%; overflow: hidden; ... }`.
    - Keep normalization lightweight: do not wrap user HTML in an additional app shell, do not remove Tailwind injection, and do not change `parsePrototypeMarkdown()` behavior.
    - In `server/index.ts`, import the two size constants from `../src/lib/prototypeUtils` alongside the existing utilities.
    - Add a concise `## 尺寸契约` section or equivalent numbered output rule to `buildCreatePrototypePrompt()` stating that the sandbox viewport is exactly `750×1624` CSS px, the prototype root should fit `100vw × 100vh`, no vertical/horizontal page scrolling should be required, and the generated HTML must not create an additional phone/browser outer shell because the app preview already supplies the frame.
    - Add the same preservation rule to `buildUpdatePrototypePrompt()`: edits must keep the `750×1624` contract and must not introduce body/page scrolling or an extra phone shell.
    - Keep all user-visible Chinese prompt text in Chinese, matching existing project decisions.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'); const utils=fs.readFileSync('src/lib/prototypeUtils.ts','utf8'); const server=fs.readFileSync('server/index.ts','utf8'); if(!/PROTOTYPE_DESIGN_WIDTH\s*=\s*750/.test(utils) || !/PROTOTYPE_DESIGN_HEIGHT\s*=\s*1624/.test(utils)) throw new Error('missing exported prototype size constants'); if(!/--prototype-design-width:\s*750px/.test(utils) || !/overflow:\s*hidden/.test(utils)) throw new Error('missing normalized canvas CSS contract'); if(!/750×1624/.test(server) || !/尺寸契约/.test(server)) throw new Error('missing prompt size contract');"</automated>
    <automated>npm run typecheck</automated>
  </verify>
  <done>`normalizePrototypeHtml()` injects the design-size CSS contract, and both create/update prototype prompts explicitly constrain generated HTML to the 750×1624 non-scrolling sandbox canvas.</done>
</task>

</tasks>

<verification>
Run the task-level automated checks, then run the required final command:

```bash
npm run typecheck
```

Optional manual smoke check if the dev app is already running: open a generated prototype in the visual cabin and confirm the visible phone preview scales to fit its panel without iframe scrollbars, while labels still show 750×1624.
</verification>

<success_criteria>
- `public/sandbox.html` owns a fixed 750×1624 design canvas and scales it by iframe viewport size.
- Existing `postMessage({ action: 'hydrate', html })` hydration still works from both preview surfaces.
- `src/lib/prototypeUtils.ts` exports reusable design-size constants and injects a minimal non-scrolling canvas CSS contract.
- `server/index.ts` creation and update prompts both mention the 750×1624 size contract and no-scroll/no-extra-phone-shell rule.
- `npm run typecheck` passes.
- No new dependencies and no unrelated UI refactor.
</success_criteria>

<output>
After completion, create `D:/learn/auto_ux_prd/.planning/quick/260601-lld-750-1624-sandbox-iframe-prompt-npm-run-t/260601-lld-SUMMARY.md`.
</output>
