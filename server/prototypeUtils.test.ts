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

console.log('prototypeUtils.test.ts: all assertions passed')
