import { normalizeReadableMarkup } from './readableMarkup'

function assertIncludes(actual: string, expected: string, message: string) {
  if (!actual.includes(expected)) throw new Error(`${message}: missing ${expected}\n${actual}`)
}

function assertExcludes(actual: string, unexpected: string, message: string) {
  if (actual.includes(unexpected)) throw new Error(`${message}: found ${unexpected}\n${actual}`)
}

const table = normalizeReadableMarkup(`
<table><thead><tr><th>功能模块</th><th>详细说明</th><th>参考</th></tr></thead>
<tbody><tr><td>入口1</td><td><ol><li>AI礼物面板增加顶部引导标签</li><li>样式：带 AI 标签+闪光动效</li></ol></td><td><img name="image.png" alt="图片展示的是AI礼物定制入口界面"></td></tr></tbody></table>
`)

assertIncludes(table, '| 功能模块 | 详细说明 | 参考 |', 'HTML table should become a Markdown table')
assertIncludes(table, 'AI礼物面板增加顶部引导标签', 'List content inside a table cell should stay readable')
assertIncludes(table, '图片展示的是AI礼物定制入口界面', 'Image alt text should be preserved')
assertExcludes(table, '<table>', 'Raw table tags should be removed')
assertExcludes(table, '<li', 'Raw list tags should be removed')

const list = normalizeReadableMarkup('<ol><li>入口</li><li>出口 &gt; 10</li></ol>')

assertIncludes(list, '1. 入口', 'Ordered lists should remain ordered')
assertIncludes(list, '2. 出口 > 10', 'HTML entities should be decoded')

console.log('readableMarkup tests passed')
