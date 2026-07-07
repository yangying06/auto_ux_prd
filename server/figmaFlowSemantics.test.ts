import assert from 'node:assert/strict'
import {
  analyzeFigmaRelation,
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
  '点击案例查看礼物效果',
  'relation intent prefers the source-side action over target-page tips',
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

assert.equal(formatFigmaRelationLabel(relationInput), '点击案例查看礼物效果')

const reason = formatFigmaRelationReason(relationInput)
assert.match(reason, /AI礼物案例 → 没创建过AI礼物/u)
assert.match(reason.split('\n')[0] ?? '', /可用关系：触发「点击案例查看礼物效果」/u)
assert.match(reason, /可用关系：触发「点击案例查看礼物效果」/u)
assert.match(reason, /规格含义：源界面需要把「点击案例查看礼物效果」定义为可执行入口/u)
assert.match(reason, /目标Frame：没创建过AI礼物/u)
assert.match(reason, /目标界面 tips：交互提示：长按礼物可预览/u)

assert.match(
  formatFigmaInteractionTipsMarkdown(targetGroup.frames),
  /交互提示：长按礼物可预览/u,
  'tips markdown exposes interaction tips as first-class node requirements',
)

const copyrightTarget = {
  label: '礼物生成步骤',
  frames: [
    {
      id: '407:3857',
      name: '礼物生成步骤',
      visibleTexts: ['上传形象', '填写 Logo', '选择素材'],
      annotations: ['涉版权IP的形象、logo等无法生成。'],
      interactionTips: [],
    },
  ],
}

const copyrightAnalysis = analyzeFigmaRelation({
  sourceGroup,
  targetGroup: copyrightTarget,
  sourceFrame: sourceGroup.frames[0],
  targetFrame: copyrightTarget.frames[0],
  fallbackLabel: 'Figma 连接线: Vector 238',
})

assert.equal(copyrightAnalysis.trigger, '点击案例查看礼物效果')
assert.match(copyrightAnalysis.effect, /版权\/IP约束/u)
assert.ok(
  copyrightAnalysis.specImplications.some((item) => /素材依赖、版权\/IP限制、Logo展示规则/u.test(item)),
  'copyright/IP evidence becomes implementation-ready relation semantics',
)
assert.ok(
  copyrightAnalysis.openQuestions.some((item) => /版权\/IP素材的校验时机/u.test(item)),
  'copyright/IP relation exposes the unresolved confirmation point',
)

const copyrightSource = {
  label: '礼物生成步骤界面',
  frames: [
    {
      id: '407:3857',
      name: '礼物生成步骤界面',
      visibleTexts: ['上传形象', '填写 Logo', '选择素材'],
      annotations: ['涉版权IP的形象、logo等无法生成。'],
      interactionTips: [],
    },
  ],
}

const exampleTarget = {
  label: 'AI礼物案例',
  frames: [
    {
      id: '4583:3516',
      name: 'AI礼物案例',
      visibleTexts: ['See what prompts others used and what effects they got.'],
      annotations: [],
      interactionTips: [],
    },
  ],
}

const sourceCopyrightAnalysis = analyzeFigmaRelation({
  sourceGroup: copyrightSource,
  targetGroup: exampleTarget,
  sourceFrame: copyrightSource.frames[0],
  targetFrame: exampleTarget.frames[0],
  fallbackLabel: 'Figma 连接线: Vector 238',
})

assert.equal(
  sourceCopyrightAnalysis.trigger,
  '版权/IP校验后进入AI礼物案例',
  'source-side copyright/IP notes become the concise relation label when no source action is explicit',
)
assert.match(sourceCopyrightAnalysis.effect, /授权素材的使用范围和兜底规则/u)
assert.ok(
  sourceCopyrightAnalysis.specImplications.some((item) => /素材依赖、版权\/IP限制/u.test(item)),
  'source-side copyright/IP notes still become implementation constraints',
)

console.log('figmaFlowSemantics tests passed')
