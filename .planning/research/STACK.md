# Technology Stack — Milestone Additions

**Project:** GameUX PromptForge — PRD Mindmap Interface
**Researched:** 2026-05-26
**Scope:** Libraries to add for markmap rendering, client-side routing, zip export, and markdown parsing

---

## Verified Versions (npm registry, 2026-05-26)

| Library | Published Latest | Registry Date |
|---------|-----------------|---------------|
| markmap-lib | 0.18.12 | 2025-06-12 |
| markmap-view | 0.18.12 | 2025-06-12 |
| markmap-common | 0.18.9 | 2025-01-21 |
| react-router | 7.15.1 | 2026-05-14 |
| react-router-dom | 7.15.1 | 2026-05-14 |
| fflate | 0.8.3 | 2026-05-16 |
| jszip | 3.10.1 | 2022-08-02 (stale) |
| remark | 15.0.1 | — |
| remark-parse | 11.0.0 | — |
| unified | 11.0.5 | — |
| markdown-it | 14.2.0 | — |
| @tanstack/react-router | 1.170.8 | 2026-05-24 |

---

## Recommended Stack Additions

### 1. Markmap Rendering in React

**Confidence: HIGH** — Verified via npm registry. No dedicated React wrapper package exists (`markmap-react` and `@markmap/react` return 404 on npm); integration is always manual via the imperative `markmap-view` API mounted into a React `useEffect`.

**Install:**
```bash
npm install markmap-lib markmap-view
```

| Package | Version | Role |
|---------|---------|------|
| `markmap-lib` | `^0.18.12` | Parses markdown text into a markmap tree data structure. Uses `markdown-it` internally. Provides `Transformer` class. |
| `markmap-view` | `^0.18.12` | Renders the tree into an SVG element using D3. Provides `Markmap` class with `.create()` and `.setData()`. Requires `d3` ^7 (already a peer dep — it installs automatically). |

**Integration pattern in React:**
```tsx
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';

const transformer = new Transformer();

function MarkmapView({ markdown }: { markdown: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    mmRef.current = Markmap.create(svgRef.current);
  }, []);

  useEffect(() => {
    if (!mmRef.current) return;
    const { root } = transformer.transform(markdown);
    mmRef.current.setData(root);
  }, [markdown]);

  return <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />;
}
```

**Custom node styles and event handling:**
markmap-view renders nodes as SVG `<g>` elements. Custom state badges (未处理/已完成) must be overlaid via a separate absolutely-positioned HTML layer that mirrors node coordinates read from the markmap instance's internal data, or by patching the `options.nodeMinHeight` / node click handlers. The `Markmap` constructor accepts an `options` object; the `click` event is not exposed directly — attach event delegation to the SVG element and use `event.target.closest('g.markmap-node')` to detect clicks.

**What NOT to use:**
- `markmap-toolbar` — UI toolbar for zoom/fit buttons; skip it, build custom controls with Tailwind instead.
- Any community `react-markmap` wrappers on npm — all are abandoned/unmaintained (verified: none found in registry with recent activity).

---

### 2. Client-Side Routing

**Confidence: HIGH** — react-router 7.15.1 published 2026-05-14 (active maintenance). Project has no existing router. Need is simple: two routes (Map view / Forge/detail view).

**Install:**
```bash
npm install react-router-dom
```

| Package | Version | Role |
|---------|---------|------|
| `react-router-dom` | `^7.15.1` | Browser history routing. v7 is the current stable line. Peer dep: React >=18. |

**Why react-router-dom over TanStack Router:**
- react-router is already the de-facto standard for Vite+React SPAs. v7 dropped the `createBrowserRouter`-only requirement; can still use declarative `<Routes>`.
- TanStack Router (1.170.8) is excellent but is file-system/codegen oriented. For two routes it is massive overkill and requires generator setup incompatible with the existing project structure.
- react-router-dom v7 has no build-step requirement — add `<BrowserRouter>` in `main.tsx`, done.

**Simple two-route setup:**
```tsx
// main.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
<BrowserRouter>
  <Routes>
    <Route path="/" element={<MapPage />} />
    <Route path="/forge/:nodeId" element={<ForgePage />} />
  </Routes>
</BrowserRouter>
```

**Tauri note:** Tauri serves the app via a custom protocol (`tauri://localhost`). Use `<MemoryRouter>` (from `react-router-dom`) instead of `<BrowserRouter>` in Tauri production builds to avoid 404s on deep link refresh. Can gate with `window.__TAURI__` detection at startup.

**What NOT to use:**
- `react-router` (bare package without `-dom`) — the DOM bindings are in `react-router-dom`; in v7 they are re-exported but using the `-dom` package is the documented approach.
- Hash router — works but produces ugly URLs; MemoryRouter is the cleaner Tauri solution.

---

### 3. Zip File Export

**Confidence: HIGH** — fflate 0.8.3 published 2026-05-16 (active). JSZip 3.10.1 last published August 2022 (stale, no updates in ~4 years).

**Install:**
```bash
npm install fflate
```

| Package | Version | Role |
|---------|---------|------|
| `fflate` | `^0.8.3` | In-browser zip creation and decompression. Synchronous and async APIs. 8kB bundle size. No native Node.js dependencies. |

**Why fflate over JSZip:**
- JSZip last release: August 2022. No updates in nearly 4 years. Open issues accumulate without triage.
- fflate: last release May 2026. Actively maintained, faster (uses Web Workers), smaller bundle.
- Both produce valid `.zip` files readable by OS zip utilities and Tauri's `@tauri-apps/plugin-fs`.

**Usage pattern (browser download):**
```typescript
import { zipSync, strToU8 } from 'fflate';

function exportSpecZip(nodes: SpecNode[]) {
  const files: Record<string, Uint8Array> = {};
  for (const node of nodes) {
    const filename = `${node.id}-${node.title}.md`;
    files[filename] = strToU8(node.markdownContent);
  }
  const zipped = zipSync(files);
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  // trigger download or pass to Tauri save dialog
}
```

**Tauri integration:** Pass the `Uint8Array` from `zipSync()` directly to `@tauri-apps/plugin-fs` `writeBinaryFile()` after using `@tauri-apps/plugin-dialog` `save()` to get the file path. No streaming needed for a spec folder that will be kilobytes to low megabytes.

**What NOT to use:**
- `jszip` — stale, superseded.
- `archiver` — Node.js only; not usable in browser context (runs client-side in this app's architecture).

---

### 4. Markdown Parsing for Tree Generation

**Confidence: HIGH** — markmap-lib already bundles `markdown-it` ^14 and exposes its `Transformer` class, which produces the tree data structure needed. No additional markdown parser is required for the mindmap rendering path.

**For server-side PRD document analysis (AI decomposition):** The Express server sends the raw markdown string to Claude. Claude returns a structured JSON tree. No server-side markdown parsing library is needed — Claude's own language understanding handles the structural decomposition.

**If heading-based pre-parsing is needed client-side** (e.g., to split a document into sections before sending to AI):

```bash
npm install remark remark-parse
```

| Package | Version | Role |
|---------|---------|------|
| `remark-parse` | `^11.0.0` | Parses markdown to mdast (Markdown AST). Part of unified ecosystem. |
| `unified` | `^11.0.5` | Plugin pipeline runner; required peer dep of remark-parse. |

**Usage pattern (heading extraction):**
```typescript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Heading } from 'mdast';

function extractHeadings(markdown: string): Heading[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  return tree.children.filter((n): n is Heading => n.type === 'heading');
}
```

**However, the preferred approach for this project:** Send the raw markdown directly to Claude via the existing Express proxy and have the AI return a structured JSON tree. This avoids introducing remark/unified (which adds ~80kB to the bundle) and produces richer semantic decomposition than heading-level parsing can achieve. Use `remark-parse` only if you need deterministic client-side section splitting independent of AI availability.

**What NOT to use:**
- `marked` — produces HTML string output, not an AST; not useful for tree building.
- `rehype` family — HTML/HAST focused, not needed for markdown-to-tree.
- A second markdown parser alongside markmap-lib — markmap-lib already includes `markdown-it`; accessing `transformer.transform(md).root` gives the full hierarchy tree. Inspect `root.children` recursively to access the tree structure.

---

## Complete npm Install Command

**Minimum required additions:**
```bash
npm install markmap-lib markmap-view react-router-dom fflate
```

**Optional (only if client-side heading pre-parsing is needed before AI call):**
```bash
npm install remark remark-parse unified
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Mindmap rendering | markmap-lib + markmap-view | react-flow, mermaid | react-flow is a generic graph library requiring full custom layout code; mermaid renders to static SVG without interactive node events |
| Routing | react-router-dom v7 | @tanstack/react-router | TanStack requires codegen/file-system routing setup; overkill for 2 routes |
| Zip export | fflate | jszip | jszip last updated 2022, unmaintained |
| Markdown parsing | markmap-lib Transformer (reuse) | remark-parse | markmap-lib already parses markdown; adding remark is redundant unless you need mdast |

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| markmap versions | HIGH | npm registry, confirmed 2026-05-26 |
| markmap React integration pattern | MEDIUM | No official React docs; pattern derived from markmap-view API surface and community convention; no official wrapper exists (confirmed via npm) |
| react-router-dom v7 | HIGH | npm registry, peer deps confirmed |
| react-router MemoryRouter for Tauri | MEDIUM | Standard pattern for custom protocol hosts; not Tauri-specific docs verified (web tools unavailable) |
| fflate over jszip | HIGH | npm registry publish dates confirm jszip staleness; fflate 0.8.3 published 2026-05-16 |
| markmap-lib Transformer reuse (no extra parser needed) | HIGH | markmap-lib dependency list confirms markdown-it ^14 is bundled |
| remark/unified versions | HIGH | npm registry confirmed |

---

*Research date: 2026-05-26. Versions verified from npm registry via `npm show`. Web search/fetch unavailable during this session.*
