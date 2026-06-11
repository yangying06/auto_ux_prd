import assert from 'node:assert/strict'
import {
  extractPrototypeHtmlContent,
  normalizeGeneratedPrototypeHtml,
  normalizePrototypeHtml,
} from '../src/lib/prototypeUtils'

const fullHtml = '<!DOCTYPE html><html lang="zh-CN"><head><title>Demo</title></head><body><main>界面</main></body></html>'

assert.equal(
  extractPrototypeHtmlContent(`我已经更新完成：\n\n${fullHtml}`),
  fullHtml,
  'extracts a complete HTML document after assistant prose',
)

assert.equal(
  extractPrototypeHtmlContent(`<file path="index.html">\n${fullHtml}\n</file>`),
  fullHtml,
  'extracts complete HTML from screenshot-to-code style file wrapper',
)

assert.equal(
  extractPrototypeHtmlContent('这里是修改说明：\n```css\n.button { color: red; }\n```'),
  null,
  'does not treat non-HTML code or prose as generated prototype HTML',
)

const generated = normalizeGeneratedPrototypeHtml(`更新后的代码：\n\`\`\`html\n${fullHtml}\n\`\`\``)
assert.ok(generated?.includes('<main>界面</main>'), 'normalizes fenced complete HTML')
assert.ok(!generated?.includes('更新后的代码'), 'drops assistant prose before previewing')

assert.equal(
  normalizeGeneratedPrototypeHtml('我会把按钮改大一点。'),
  null,
  'rejects prose-only generation output',
)

assert.ok(
  normalizePrototypeHtml('<div>旧版片段</div>').includes('<div>旧版片段</div>'),
  'keeps legacy fragment normalization for existing saved previews',
)

const normalizedFullHtml = normalizePrototypeHtml(fullHtml)
const injectedScripts = [...normalizedFullHtml.matchAll(/<script>\s*([\s\S]*?)<\/script>/gu)].map((match) => match[1])
const annotationStripScript = injectedScripts.find((script) => script.includes('removePrototypeAnnotations'))
assert.ok(annotationStripScript, 'injects annotation stripping runtime script')
assert.doesNotThrow(
  () => new Function(annotationStripScript),
  'annotation stripping runtime script is syntactically valid',
)
assert.ok(
  normalizedFullHtml.includes('body * { max-width: 100vw; }'),
  'keeps generic width normalization for non-Figma prototypes',
)
assert.ok(
  normalizedFullHtml.includes('[data-prototype-annotation]'),
  'injects annotation selectors for generated prototypes',
)
assert.ok(
  normalizedFullHtml.includes('display: none !important;'),
  'hides annotation elements before runtime stripping',
)
assert.ok(
  normalizedFullHtml.includes('removePrototypeAnnotations'),
  'injects runtime annotation removal safeguard for generated prototypes',
)
assert.ok(
  normalizedFullHtml.includes('stripAnnotationTextPattern'),
  'removes compact Chinese annotation text labels',
)

const figmaHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>UISlotsMain Figma Prototype</title>
  <style>
    .pf-shell { position: relative; width: 750px; height: 1624px; }
    .pf-stage { position: absolute; width: 750px; height: 1624px; transform: scale(var(--pf-scale)); }
  </style>
</head>
<body>
  <main class="pf-shell">
    <section class="pf-stage" data-generator="figma2prefab" data-node-count="42"></section>
  </main>
</body>
</html>`

const normalizedFigmaHtml = normalizePrototypeHtml(figmaHtml)
assert.ok(
  normalizedFigmaHtml.includes('width: 750px; height: 1624px;'),
  'keeps Figma2Prefab design-stage dimensions',
)
assert.ok(
  !normalizedFigmaHtml.includes('body * { max-width: 100vw; }'),
  'does not inject generic descendant max-width into Figma2Prefab prototypes',
)
assert.ok(
  normalizedFigmaHtml.includes('[data-prototype-annotation]'),
  'keeps annotation stripping selectors for Figma2Prefab prototypes',
)

console.log('prototypeUtils.test.ts: all assertions passed')
