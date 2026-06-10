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

const performancePatch = extractNodeChatSuffix(`已补齐金币飞入的接入方式。
{"nodeComplete":false,"intents":["document_polish"],"prototypeInstruction":null,"nodePatch":{"performanceSpec":{"detected":true,"source":"ai","confidence":86,"eventTypes":["金币/数值获得"],"integrationModes":["Cocos Tween 变换","ParticleSystem 粒子","Prefab 特效/弹窗"],"trigger":"结算结果返回后触发","branches":[],"sequence":[],"assets":[],"layers":[],"controls":[],"endState":null,"openQuestions":[],"prototypeNotes":[]}}}`)

assert.deepEqual(
  performancePatch.nodePatch?.performanceSpec?.integrationModes,
  ['Cocos Tween 变换', 'ParticleSystem 粒子', 'Prefab 特效/弹窗'],
  'preserves performance integration modes',
)

const performanceRiskPatch = extractNodeChatSuffix(`主流程已经可交付，但表现还有一个风险槽位需要后续确认。
{"nodeComplete":true,"intents":["document_polish"],"prototypeInstruction":null,"nodePatch":{"performanceSpec":{"detected":true,"source":"ai","confidence":88,"eventTypes":["金币/数值获得"],"integrationModes":["Cocos Tween 变换","ParticleSystem 粒子","Prefab 特效/弹窗"],"trigger":"结算结果返回后触发","branches":["普通结算和大奖结算复用同一飞入流程"],"sequence":[{"title":"资产飞入","detail":"coin prefab 沿路径飞入资产栏","layer":"UIEffect","assets":["coin_prefab"],"waitFor":"最后一枚飞入结束"}],"assets":["coin_prefab","coin_trail_particle"],"layers":["UIEffect","HUD"],"controls":["播放期间合并重复结算"],"endState":null,"openQuestions":["飞入结束后刷新最终数值是在第一枚、最后一枚还是所有粒子结束后？"],"prototypeNotes":[],"slotStatus":{"trigger":{"status":"confirmed","detail":"结算结果返回后触发"},"branches":{"status":"confirmed"},"sequence":{"status":"confirmed"},"integrationModes":{"status":"confirmed"},"assets":{"status":"confirmed"},"layers":{"status":"confirmed"},"controls":{"status":"confirmed"},"endState":{"status":"missing","question":"播放完成后哪些数值、按钮或列表需要刷新？"}},"blockingQuestion":{"slot":"endState","question":"飞入结束后刷新最终数值是在第一枚、最后一枚还是所有粒子结束后？"},"readiness":{"score":88,"level":"risk","confirmedSlots":["trigger","branches","sequence","integrationModes","assets","layers","controls"],"inferredSlots":[],"missingSlots":["endState"],"waivedSlots":[],"riskSummary":"主流程可交付，但结束状态仍未由设计师确认。"},"waivedReason":null}}}`)

assert.equal(performanceRiskPatch.nodeComplete, true, 'allows nodeComplete true with performance risk')
assert.equal(
  performanceRiskPatch.nodePatch?.performanceSpec?.slotStatus?.endState.status,
  'missing',
  'preserves missing slot status',
)
assert.deepEqual(
  performanceRiskPatch.nodePatch?.performanceSpec?.blockingQuestion,
  {
    slot: 'endState',
    question: '飞入结束后刷新最终数值是在第一枚、最后一枚还是所有粒子结束后？',
  },
  'preserves blocking question',
)
assert.equal(performanceRiskPatch.nodePatch?.performanceSpec?.readiness?.level, 'risk', 'preserves readiness risk level')
assert.deepEqual(
  performanceRiskPatch.nodePatch?.performanceSpec?.readiness?.missingSlots,
  ['endState'],
  'preserves readiness missing slots',
)

const fallback = extractNodeChatSuffix('这里只是一段普通回复。')

assert.equal(fallback.reply, '这里只是一段普通回复。', 'keeps prose-only reply')
assert.equal(fallback.nodeComplete, false, 'defaults nodeComplete to false')
assert.equal(fallback.nodePatch, null, 'defaults nodePatch to null')
assert.deepEqual(fallback.intents, [], 'defaults intents to empty')
assert.equal(fallback.prototypeInstruction, null, 'defaults prototypeInstruction to null')

console.log('nodeChatResponse.test.ts: all assertions passed')
