import assert from 'node:assert/strict'
import { extractNodeChatSuffix } from './nodeChatResponse'

const mixed = extractNodeChatSuffix(String.raw`已更新验收标准，并会同步调整原型。
{"nodeComplete":false,"intents":["document_polish","prototype_update"],"prototypeInstruction":"把主按钮改成金色","nodePatch":{"summary":"补齐按钮验收标准","content":"## 验收标准\n- 点击后展示确认弹窗","techNotes":"需要覆盖二次确认状态"}}`)

assert.equal(mixed.reply, '已更新验收标准，并会同步调整原型。', 'strips trailing JSON from reply')
assert.equal(mixed.nodeComplete, false, 'normalizes nodeComplete')
assert.deepEqual(mixed.intents, ['document_polish', 'prototype_update'], 'preserves valid multi-intents')
assert.equal(mixed.prototypeInstruction, '把主按钮改成金色', 'normalizes prototype instruction')
assert.deepEqual(
  mixed.nodePatch,
  {
    summary: '补齐按钮验收标准',
    content: '## 验收标准\n- 点击后展示确认弹窗',
    techNotes: '需要覆盖二次确认状态',
  },
  'normalizes nodePatch fields',
)

const referenceOnly = extractNodeChatSuffix(`我会把参考图差异写入文档。
{"nodeComplete":false,"intents":["reference_feedback"],"prototypeInstruction":null,"nodePatch":{"content":"参考图显示主按钮应置于底部安全区上方。"}}`)

assert.deepEqual(referenceOnly.intents, ['reference_feedback'], 'preserves reference feedback intent')
assert.equal(referenceOnly.prototypeInstruction, null, 'missing prototype instruction stays null')
assert.deepEqual(referenceOnly.nodePatch, { content: '参考图显示主按钮应置于底部安全区上方。' }, 'keeps reference document patch')

const fallback = extractNodeChatSuffix('这里只是一段普通回复。')

assert.equal(fallback.reply, '这里只是一段普通回复。', 'keeps prose-only reply')
assert.equal(fallback.nodeComplete, false, 'defaults nodeComplete to false')
assert.equal(fallback.nodePatch, null, 'defaults nodePatch to null')
assert.deepEqual(fallback.intents, [], 'defaults intents to empty')
assert.equal(fallback.prototypeInstruction, null, 'defaults prototypeInstruction to null')

console.log('nodeChatResponse.test.ts: all assertions passed')
