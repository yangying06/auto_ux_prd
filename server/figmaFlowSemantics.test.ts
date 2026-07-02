import assert from 'node:assert/strict'
import {
  deriveFigmaRelationIntent,
  formatFigmaInteractionTipRequirement,
  formatFigmaInteractionTipsMarkdown,
  formatFigmaRelationLabel,
  formatFigmaRelationReason,
  normalizeFigmaInteractionTipText,
} from './figmaFlowSemantics'

const sourceGroup = {
  label: 'AI礼物案例',
  frames: [
    {
      id: '173:3598',
      name: 'AI礼物案例',
      visibleTexts: ['点击案例查看礼物效果'],
      annotations: [],
      interactionTips: [],
    },
  ],
}

const targetGroup = {
  label: '没创建过AI礼物',
  frames: [
    {
      id: '211:5391',
      name: '没创建过AI礼物',
      visibleTexts: ['创建你的第一个 AI 礼物'],
      annotations: ['Interaction tip: Long press the gift to preview it~'],
      interactionTips: ['交互提示：Long press the gift to preview it~'],
    },
  ],
}

assert.equal(
  normalizeFigmaInteractionTipText('Interaction tip: Long press the gift to preview it~'),
  '长按礼物可预览',
  'English Figma interaction tips are normalized into concise Chinese intent',
)

assert.equal(
  formatFigmaInteractionTipRequirement('Long press the gift to preview it~'),
  '交互提示：长按礼物可预览',
  'formatted tip is a requirement-ready Chinese note',
)

assert.equal(
  deriveFigmaRelationIntent({
    sourceGroup,
    targetGroup,
    sourceFrame: sourceGroup.frames[0],
    targetFrame: targetGroup.frames[0],
    fallbackLabel: 'Figma 连接线: Vector 249',
  }),
  '长按礼物可预览',
  'relation intent prefers concrete Figma tips over generic vector names',
)

const relationInput = {
  connectorName: 'Vector 249',
  connectorId: '211:5391',
  sourceGroup,
  targetGroup,
  sourceFrame: sourceGroup.frames[0],
  targetFrame: targetGroup.frames[0],
  direction: 'endpoint_meta',
  sourcePoint: '(100,200,m=5)',
  targetPoint: '(300,400,m=2)',
  fallbackLabel: 'Figma 连接线: Vector 249',
}

assert.equal(formatFigmaRelationLabel(relationInput), '长按礼物可预览')

const reason = formatFigmaRelationReason(relationInput)
assert.match(reason, /AI礼物案例 → 没创建过AI礼物/u)
assert.match(reason, /交互意图：长按礼物可预览/u)
assert.match(reason, /目标Frame：没创建过AI礼物/u)
assert.match(reason, /目标界面 tips：交互提示：长按礼物可预览/u)

assert.match(
  formatFigmaInteractionTipsMarkdown(targetGroup.frames),
  /交互提示：长按礼物可预览/u,
  'tips markdown exposes interaction tips as first-class node requirements',
)

console.log('figmaFlowSemantics tests passed')
