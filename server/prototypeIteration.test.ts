import assert from 'node:assert/strict'
import {
  buildFigmaPrototypeIterationInstruction,
  mergeInstructionIntoPrototypeEvidence,
} from '../src/lib/prototypeIteration'
import type { ContentBlock } from '../src/types/chat'

const updateInstruction = buildFigmaPrototypeIterationInstruction(
  { panelName: 'Reward Item', imageCount: 3 },
  true,
)
assert.match(updateInstruction, /增量更新当前右侧 HTML 原型/u, 'existing prototype uses update instruction')
assert.match(updateInstruction, /3 张 Figma 视觉证据/u, 'instruction includes Figma evidence count')

const numericSlotInstruction = buildFigmaPrototypeIterationInstruction(
  {
    panelName: 'Reward Item',
    imageCount: 2,
    images: [
      { numericTextSlots: [{ slotId: 'num-1' }] },
      { numericTextSlots: [{ slotId: 'num-2' }, { slotId: 'num-3' }] },
    ],
  },
  true,
)
assert.match(numericSlotInstruction, /已去除 3 处示例数值/u, 'instruction includes numeric slot count')
assert.match(numericSlotInstruction, /不要恢复 Figma 示例数字/u, 'instruction forbids restoring example numbers')

const createInstruction = buildFigmaPrototypeIterationInstruction(
  { panelName: 'Reward Item', imageCount: 3 },
  false,
)
assert.match(createInstruction, /生成右侧 HTML 原型/u, 'missing prototype uses create instruction')

const textEvidence = mergeInstructionIntoPrototypeEvidence(
  '把 item 图片换成 Figma 里的金币图',
  'Figma Frame：Reward Item',
)
assert.equal(
  textEvidence,
  '用户本轮 UI 迭代要求：\n把 item 图片换成 Figma 里的金币图\n\nFigma Frame：Reward Item',
  'text evidence keeps both user instruction and Figma evidence',
)

const imageEvidence: ContentBlock[] = [
  { type: 'text', text: 'Figma 子图：金币 item' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
]
const mergedImageEvidence = mergeInstructionIntoPrototypeEvidence('替换 item 图片', imageEvidence)
assert.ok(Array.isArray(mergedImageEvidence), 'image evidence remains block content')
assert.equal(mergedImageEvidence?.length, 2, 'image block is preserved')
assert.match(
  typeof mergedImageEvidence !== 'string' ? mergedImageEvidence[0]?.type === 'text' ? mergedImageEvidence[0].text : '' : '',
  /用户本轮 UI 迭代要求：\n替换 item 图片/u,
  'block evidence prepends instruction text',
)

console.log('prototypeIteration.test.ts: all assertions passed')
