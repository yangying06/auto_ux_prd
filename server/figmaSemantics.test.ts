import assert from 'node:assert/strict'
import {
  buildHeuristicFigmaUxMap,
  buildFigmaUiStatesForFrames,
  chooseFigmaMetaTargetEndpointIndex,
  chooseStableFigmaLineMergeCandidate,
  classifyFigmaUiState,
  collectNearbyFigmaAnnotations,
  collectNearbyFigmaInteractionTips,
  createFigmaStateTransition,
  extractFigmaStateTransitionCue,
  isStrictFigmaInterfaceFrameSize,
  normalizeFigmaScreenFamilyLabel,
  normalizeFigmaUxMap,
  uniqueFigmaStateTransitions,
} from './figmaSemantics'

assert.equal(isStrictFigmaInterfaceFrameSize(750, 1624), true, '750px wide tall frame is an interface candidate')
assert.equal(isStrictFigmaInterfaceFrameSize(755, 1687), true, 'width tolerance accepts +/-10px')
assert.equal(isStrictFigmaInterfaceFrameSize(750, 806), false, 'short 750px fragments are scatter images')
assert.equal(isStrictFigmaInterfaceFrameSize(720, 1624), false, 'non-750px tall frames are not primary interfaces')

assert.equal(
  chooseFigmaMetaTargetEndpointIndex([
    { index: 0, meta: 2 },
    { index: 1, meta: 0 },
    { index: 2, meta: 2 },
  ]),
  1,
  'multi-endpoint vector uses the unique lowest endpoint_meta as the target sink',
)
assert.equal(
  chooseFigmaMetaTargetEndpointIndex([
    { index: 0, meta: 0 },
    { index: 1, meta: 0 },
    { index: 2, meta: 2 },
  ]),
  null,
  'multi-endpoint vector refuses ambiguous duplicated target meta values',
)
assert.deepEqual(
  chooseStableFigmaLineMergeCandidate([
    { targetGroupKey: 'screen-b', distance: 10 },
    { targetGroupKey: 'screen-b', distance: 14 },
  ], 48),
  { targetGroupKey: 'screen-b', distance: 10 },
  'line merge accepts a short branch joining deterministic connectors with the same target',
)
assert.equal(
  chooseStableFigmaLineMergeCandidate([
    { targetGroupKey: 'screen-b', distance: 10 },
    { targetGroupKey: 'screen-d', distance: 16 },
  ], 48),
  null,
  'line merge refuses nearby conflicting deterministic connector targets',
)

assert.equal(normalizeFigmaScreenFamilyLabel('没创建过AI礼物'), '是否创建过AI礼物界面', 'negative created-state title maps to one screen family')
assert.equal(normalizeFigmaScreenFamilyLabel('有创建过AI礼物_管理自建礼物中'), '是否创建过AI礼物界面', 'positive created-state variant maps to same screen family')
assert.equal(normalizeFigmaScreenFamilyLabel('礼物生成步骤1'), '礼物生成步骤界面', 'step 1 maps to the generation-step screen family')
assert.equal(normalizeFigmaScreenFamilyLabel('礼物生成步骤3_生成失败'), '礼物生成步骤界面', 'success/failure step variants map to the same screen family')
assert.equal(normalizeFigmaScreenFamilyLabel('支付成功'), '支付界面', 'success/failure antonym titles map to one screen family')

const overlay = classifyFigmaUiState('长按礼物图标打开AI礼物预览_半屏浮层', 'AI礼物预览')
assert.equal(overlay.kind, 'overlay', 'half-screen floating layer is classified as overlay state')
assert.match(overlay.label, /半屏浮层|浮层/u, 'overlay label keeps the explicit state term')

const annotations = collectNearbyFigmaAnnotations(
  {
    id: '22:1774',
    name: 'AI礼物预览_半屏浮层',
    sourceUrl: 'https://figma.example',
    x: 100,
    y: 200,
    width: 375,
    height: 812,
    visibleTexts: ['赠送'],
  },
  [
    { id: 'note-1', text: '注释：长按礼物图标打开AI礼物预览浮层', x: 110, y: 140, width: 360, height: 32 },
    { id: 'inside-1', text: '赠送', x: 150, y: 300, width: 80, height: 24 },
    { id: 'far-1', text: '无关规则说明', x: 2000, y: 2000, width: 120, height: 24 },
  ],
)
assert.deepEqual(annotations, ['注释：长按礼物图标打开AI礼物预览浮层'], 'nearby annotations exclude inside and far text')

const tipFrame = {
  id: '22:1774',
  name: 'AI礼物预览_半屏浮层',
  sourceUrl: 'https://figma.example',
  x: 100,
  y: 200,
  width: 375,
  height: 812,
  visibleTexts: ['赠送'],
}
const tips = collectNearbyFigmaInteractionTips(
  tipFrame,
  [
    // callout 画在 frame 右侧外部 —— Figma 常见标注习惯
    { id: 'tip-right', text: 'Interaction tip: Long press the gift to preview it~', x: 500, y: 240, width: 220, height: 28, kind: 'interaction_tip' },
    // callout 画在 frame 上方外部
    { id: 'tip-above', text: '交互提示：点击案例查看礼物效果', x: 120, y: 150, width: 240, height: 24, kind: 'interaction_tip' },
    // 普通注解，应被过滤
    { id: 'anno-1', text: '注释：颜色规范', x: 110, y: 140, width: 120, height: 20, kind: 'annotation' },
    // 距离过远的 tips，应被排除
    { id: 'tip-far', text: 'Interaction tip: 远处无关提示', x: 3000, y: 3000, width: 200, height: 24, kind: 'interaction_tip' },
  ],
)
assert.ok(tips.includes('Interaction tip: Long press the gift to preview it~'), 'interaction tips drawn OUTSIDE the frame (right-side callout) are still collected')
assert.ok(tips.includes('交互提示：点击案例查看礼物效果'), 'interaction tips drawn above the frame are collected')
assert.ok(!tips.some((text) => text.includes('颜色规范')), 'plain annotations are excluded from interaction tips')
assert.ok(!tips.some((text) => text.includes('远处无关提示')), 'far-away tips are excluded by geometry')

const cue = extractFigmaStateTransitionCue('长按礼物图标打开AI礼物预览_半屏浮层')
assert.ok(cue, 'trigger phrase is parsed from frame title')
assert.equal(cue?.trigger, '长按礼物图标')
assert.equal(cue?.targetHint, 'AI礼物预览')
assert.match(cue?.effect ?? '', /打开/u)

const states = buildFigmaUiStatesForFrames('PAGE-FIGMA-01-gift', 'AI礼物预览', [
  {
    id: '22:1774',
    name: '长按礼物图标打开AI礼物预览_半屏浮层',
    sourceUrl: 'https://figma.example?node-id=22-1774',
    assetUrl: '/api/figma/preview.png',
    x: 100,
    y: 200,
    width: 375,
    height: 812,
    visibleTexts: ['赠送', 'AI定制'],
    annotations,
  },
])
assert.equal(states[0]?.kind, 'overlay', 'state builder preserves overlay kind')
assert.deepEqual(states[0]?.annotations, annotations, 'state builder carries annotations')

const transition = createFigmaStateTransition({
  id: 't-1',
  sourceNodeId: 'PAGE-A',
  targetNodeId: 'PAGE-B',
  targetStateId: states[0]?.id,
  trigger: cue?.trigger,
  effect: cue?.effect,
  evidence: [cue?.evidence ?? '', cue?.evidence ?? ''],
  confidence: 86,
})
assert.deepEqual(transition.evidence, ['长按礼物图标打开AI礼物预览_半屏浮层'], 'transition evidence is deduped')
assert.equal(uniqueFigmaStateTransitions([transition, transition]).length, 1, 'duplicate transitions are removed')

const uxMap = buildHeuristicFigmaUxMap({
  sourceUrl: 'https://figma.example/design/file?node-id=0-1',
  rootName: '用户AI定制礼物',
  groups: [
    {
      key: 'ai礼物预览',
      label: 'AI礼物预览',
      frames: [
        {
          id: '22:1774',
          name: 'AI礼物预览_默认态',
          sourceUrl: 'https://figma.example?node-id=22-1774',
          assetUrl: '/assets/default.png',
          x: 100,
          y: 200,
          width: 375,
          height: 812,
          visibleTexts: ['赠送'],
          annotations: [],
        },
        {
          id: '22:1775',
          name: '长按礼物图标打开AI礼物预览_半屏浮层',
          sourceUrl: 'https://figma.example?node-id=22-1775',
          assetUrl: '/assets/overlay.png',
          x: 520,
          y: 200,
          width: 375,
          height: 480,
          visibleTexts: ['AI定制'],
          annotations: ['说明：长按礼物图标打开AI礼物预览半屏浮层'],
        },
      ],
    },
    {
      key: '礼物背包',
      label: '礼物背包',
      frames: [
        {
          id: '33:1',
          name: '礼物背包',
          sourceUrl: 'https://figma.example?node-id=33-1',
          assetUrl: '/assets/bag.png',
          x: 1000,
          y: 200,
          width: 375,
          height: 812,
          visibleTexts: ['背包'],
          annotations: [],
        },
      ],
    },
  ],
  relations: [
    {
      sourceGroupKey: '礼物背包',
      targetGroupKey: 'ai礼物预览',
      label: 'Figma 箭头连接',
      reason: 'Figma connector arrow points from 礼物背包 to AI礼物预览.',
      confidence: 91,
      source: 'figma_connector',
    },
  ],
})
assert.equal(uxMap.screens.length, 2, 'ux map keeps two screen families')
assert.equal(uxMap.states.filter((state) => state.screenId === uxMap.screens[0]?.id).length, 2, 'ux map keeps same-screen states together')
assert.equal(uxMap.states.find((state) => state.figmaNodeId === '22:1775')?.role, 'overlay', 'overlay frame becomes overlay state role')
assert.ok(
  uxMap.transitions.some((item) => item.source === 'frame_title' && item.targetStateId === uxMap.states.find((state) => state.figmaNodeId === '22:1775')?.id),
  'frame title cue becomes state transition into overlay state',
)
assert.ok(
  uxMap.transitions.some((item) => item.source === 'figma_connector' && item.targetScreenId === uxMap.screens[0]?.id),
  'figma connector relation becomes screen transition',
)

const normalizedReview = normalizeFigmaUxMap({
  review: { source: 'ai_review', confidence: 88, notes: ['把半屏浮层保留为 AI礼物预览 的状态。'] },
  screens: [
    { id: uxMap.screens[0]?.id, label: 'AI定制礼物预览', groupKey: 'ai礼物预览' },
  ],
  transitions: [
    {
      id: 'ai-transition-1',
      sourceScreenId: uxMap.screens[1]?.id,
      targetScreenId: uxMap.screens[0]?.id,
      trigger: '点击背包礼物',
      effect: '打开AI礼物预览',
      evidence: ['AI review over Figma notes'],
      confidence: 84,
      source: 'ai_review',
    },
  ],
}, uxMap)
assert.equal(normalizedReview?.review.source, 'ai_review', 'normalized AI review marks review source')
assert.equal(normalizedReview?.screens[0]?.label, 'AI定制礼物预览', 'AI review may relabel existing screens')
assert.ok(normalizedReview?.transitions.some((item) => item.id === 'ai-transition-1'), 'AI review may add transition using existing screen ids')
assert.equal(normalizeFigmaUxMap({ screens: [] }, uxMap)?.screens.length, uxMap.screens.length, 'invalid review falls back to heuristic map')

const connectorTransition = uxMap.transitions.find((item) => item.source === 'figma_connector')
assert.ok(connectorTransition, 'test fixture has a connector transition')
const connectorLockedReview = normalizeFigmaUxMap({
  transitions: [
    {
      ...connectorTransition,
      sourceScreenId: connectorTransition.targetScreenId,
      targetScreenId: connectorTransition.sourceScreenId,
      evidence: ['AI tried to reverse deterministic vector line direction'],
    },
  ],
}, uxMap)
const lockedConnector = connectorLockedReview?.transitions.find((item) => item.id === connectorTransition.id)
assert.equal(lockedConnector?.sourceScreenId, connectorTransition.sourceScreenId, 'AI review cannot reverse deterministic Figma connector source')
assert.equal(lockedConnector?.targetScreenId, connectorTransition.targetScreenId, 'AI review cannot reverse deterministic Figma connector target')
assert.deepEqual(lockedConnector?.evidence, connectorTransition.evidence, 'AI review cannot replace deterministic Figma connector evidence')

const tipState = uxMap.states[0]!
const tipFallback = {
  ...uxMap,
  states: uxMap.states.map((state) => state.id === tipState.id
    ? { ...state, annotations: ['Interaction tip: Long press the gift to preview it~', '交互提示：长按礼物图标打开预览浮层', 'Original note'] }
    : state),
}
const tipProtectedReview = normalizeFigmaUxMap({
  states: [
    {
      id: tipState.id,
      annotations: ['AI总结：礼物预览用于确认生成效果。'],
    },
  ],
}, tipFallback)
const protectedTipState = tipProtectedReview?.states.find((state) => state.id === tipState.id)
assert.ok(protectedTipState?.annotations.some((item) => item.includes('长按礼物图标打开预览浮层')), 'Chinese interaction tips survive AI annotation review')
assert.ok(protectedTipState?.annotations.includes('AI总结：礼物预览用于确认生成效果。'), 'Chinese AI-reviewed annotations are accepted alongside locked tips')
assert.ok(!protectedTipState?.annotations.some((item) => /Long press|Original note/u.test(item)), 'English annotation text is filtered from state annotations')

const visualSummaryReview = normalizeFigmaUxMap({
  screens: [
    {
      id: uxMap.screens[0]?.id,
      label: '礼物预览主界面',
    },
  ],
  states: [
    {
      id: tipState.id,
      label: '礼物预览默认态',
      annotations: ['AI总结：该界面预览生成后的礼物，并说明长按入口。'],
    },
  ],
}, tipFallback)
const visualSummaryState = visualSummaryReview?.states.find((state) => state.id === tipState.id)
assert.equal(visualSummaryReview?.screens[0]?.label, '礼物预览主界面', 'AI review can replace a weak frame-derived screen title')
assert.equal(visualSummaryState?.label, '礼物预览默认态', 'AI review can replace a weak frame-derived state title')
assert.ok(visualSummaryState?.annotations.some((item) => item.startsWith('AI总结：')), 'Chinese AI visual summary is carried in state annotations')

console.log('figmaSemantics.test.ts: all assertions passed')
