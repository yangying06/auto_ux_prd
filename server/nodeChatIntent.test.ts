import assert from 'node:assert/strict'
import {
  buildUiOnlyPrototypeInstruction,
  extractFigmaUrlFromText,
  extractFigmaUrlsFromText,
  hasExplicitDocumentUpdateRequest,
  isUiOnlyPrototypeText,
} from '../src/lib/nodeChatIntent'

const figmaItemSwap = '把奖励 item 的图片换成这个 Figma 链接里的素材：https://www.figma.com/design/abc/Reward?node-id=12-34'
assert.equal(isUiOnlyPrototypeText(figmaItemSwap), true, 'Figma item image swap is UI-only')
assert.equal(
  extractFigmaUrlFromText(figmaItemSwap),
  'https://www.figma.com/design/abc/Reward?node-id=12-34',
  'extracts Figma URL from UI feedback',
)
assert.deepEqual(
  extractFigmaUrlsFromText([
    '列表 item 用这些 Figma 素材：',
    'https://www.figma.com/design/abc/Reward?node-id=12-34',
    'https://www.figma.com/file/xyz/Shop?node-id=56-78。',
    '重复链接 https://www.figma.com/file/xyz/Shop?node-id=56-78',
  ].join('\n')),
  [
    'https://www.figma.com/design/abc/Reward?node-id=12-34',
    'https://www.figma.com/file/xyz/Shop?node-id=56-78',
  ],
  'extracts and deduplicates multiple Figma URLs',
)
assert.match(
  buildUiOnlyPrototypeInstruction(figmaItemSwap),
  /迭代右侧 UI 原型/u,
  'UI-only feedback builds prototype instruction',
)

assert.equal(
  isUiOnlyPrototypeText('不要改需求，把 item 图片按这个 Figma 换掉 https://www.figma.com/file/abc?node-id=1-2'),
  true,
  'explicitly saying not to change requirements still routes to UI',
)

assert.equal(
  isUiOnlyPrototypeText('请把主按钮点击后的校验规则写进需求文档'),
  false,
  'explicit requirement-document request is not UI-only',
)
assert.equal(
  hasExplicitDocumentUpdateRequest('请把主按钮点击后的校验规则写进需求文档'),
  true,
  'detects explicit document update request',
)

assert.equal(
  isUiOnlyPrototypeText('把按钮颜色改成金色'),
  true,
  'visual control styling change is UI-only',
)

console.log('nodeChatIntent.test.ts: all assertions passed')
