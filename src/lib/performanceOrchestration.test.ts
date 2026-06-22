import type { PrdNode } from '../types/prdNode'
import {
  applyPerformanceAnswerFast,
  createNoSpecialPerformanceSpec,
  formatPerformanceSpecMarkdown,
  inferPerformanceSpecFromNode,
  normalizePerformanceSpec,
} from './performanceOrchestration'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertIncludes(items: string[], expected: string, message: string) {
  assert(items.includes(expected), `${message}: expected "${expected}" in ${JSON.stringify(items)}`)
}

function makeNode(overrides: Partial<PrdNode>): PrdNode {
  return {
    id: 'node-test',
    parentId: null,
    label: '测试节点',
    summary: '',
    content: '',
    type: 'ui',
    status: 'pending_refine',
    level: 0,
    order: 0,
    needsPolish: true,
    extractedFrom: null,
    techNotes: null,
    children: [],
    ...overrides,
  }
}

const coinSpec = inferPerformanceSpecFromNode(makeNode({
  label: '金币飞入结算',
  content: '结算后实例化 coin prefab 队列，播放金币飞入资产栏，数值滚动到最终金额，并使用 ParticleSystem2D 拖尾和 SequenceFrameComp 金币序列帧。',
}))

assert(coinSpec, 'coin node should produce performance spec')
assertIncludes(coinSpec.eventTypes, '金币/数值获得', 'coin node should detect reward value motion')
assertIncludes(coinSpec.integrationModes ?? [], '平台动效变换', 'coin node should suggest programmatic motion integration')
assertIncludes(coinSpec.integrationModes ?? [], '粒子/特效资源', 'coin node should suggest particle integration')
assertIncludes(coinSpec.integrationModes ?? [], '组件/弹窗特效', 'coin node should suggest component integration through reward collect wording')
assert(
  coinSpec.openQuestions.some((question) => question.includes('飞入') && question.includes('数值')),
  'coin node should ask implementation-blocking value/fly-in question',
)
assert(coinSpec.blockingQuestion?.slot === 'sequence', 'coin node should prioritize fly-in sequence as blocking slot')
assert(
  Boolean(coinSpec.blockingQuestion?.question.includes('飞入') && coinSpec.blockingQuestion.question.includes('路径')),
  'coin node should prioritize path/count fly-in question',
)
assert(
  coinSpec.openQuestions.some((question) => question.includes('播放完成') || question.includes('刷新')),
  'coin node should ask end-state question',
)
assert(coinSpec.readiness?.level === 'risk', 'auto-inferred coin spec should be a soft risk, not fully ready')
assert(coinSpec.slotStatus?.sequence.status === 'inferred', 'auto sequence should be marked inferred')

const fastSequenceAnswer = applyPerformanceAnswerFast(
  coinSpec,
  '各阶段需要按顺序播放，上一段完成后再进入下一段。',
)
assert(fastSequenceAnswer, 'fast performance answer should update simple template replies without an AI call')
assert(
  fastSequenceAnswer.performanceSpec.slotStatus?.sequence.status === 'confirmed',
  'fast answer should confirm the currently blocking slot',
)
assert(
  fastSequenceAnswer.performanceSpec.blockingQuestion?.slot !== 'sequence',
  'fast answer should advance to the next blocking slot',
)
assert(
  fastSequenceAnswer.reply.includes('整体理解度'),
  'fast answer should return the same compact question format',
)

const assetSpec = inferPerformanceSpecFromNode(makeNode({
  label: '奖励揭晓特效',
  content: '奖励揭晓时实例化 reward prefab，在 UIEffect 层播放 Spine Skeleton 动画，并叠加 ParticleSystem2D 光效。',
}))

assert(assetSpec, 'asset node should produce performance spec')
assertIncludes(assetSpec.integrationModes ?? [], 'Spine/Skeleton', 'asset node should detect Spine integration')
assertIncludes(assetSpec.integrationModes ?? [], '粒子/特效资源', 'asset node should detect particle integration')
assertIncludes(assetSpec.integrationModes ?? [], '组件/弹窗特效', 'asset node should detect component integration')

const plainSpec = inferPerformanceSpecFromNode(makeNode({
  label: '设置入口',
  content: '点击设置按钮后打开设置页面，页面展示标题、开关和返回按钮。',
}))

assert(plainSpec === null, 'plain UI node should not create noisy performance spec')

const legacySpec = normalizePerformanceSpec({
  detected: true,
  source: 'ai',
  confidence: 80,
  eventTypes: ['弹窗/揭晓表现'],
  trigger: '点击奖励按钮',
  branches: [],
  sequence: [],
  assets: [],
  layers: [],
  controls: [],
  endState: null,
  openQuestions: [],
  prototypeNotes: [],
})

assert(legacySpec, 'legacy performance spec should normalize')
assert(Array.isArray(legacySpec.integrationModes), 'legacy performance spec should get integrationModes array')
assert(legacySpec.integrationModes.length === 0, 'legacy performance spec should default integrationModes to empty array')
assert(legacySpec.slotStatus?.integrationModes.status === 'missing', 'legacy missing integration modes should be tracked as missing')
assert(legacySpec.readiness?.missingSlots.includes('integrationModes'), 'legacy readiness should include missing integration modes')
assert(legacySpec.blockingQuestion?.slot === 'sequence', 'legacy spec should ask playback sequence before implementation mode')

const contradictoryReadinessSpec = normalizePerformanceSpec({
  detected: true,
  source: 'ai',
  confidence: 90,
  eventTypes: ['弹窗/揭晓表现'],
  integrationModes: ['组件/弹窗特效'],
  trigger: '点击奖励按钮',
  branches: ['普通奖励和大奖分支'],
  sequence: [{ title: '弹窗入场', detail: '播放 prefab 入场' }],
  assets: ['reward_popup'],
  layers: ['PopUp'],
  controls: ['点击关闭'],
  endState: null,
  openQuestions: [],
  prototypeNotes: [],
  slotStatus: {
    trigger: { status: 'confirmed' },
    branches: { status: 'confirmed' },
    sequence: { status: 'confirmed' },
    integrationModes: { status: 'confirmed' },
    assets: { status: 'confirmed' },
    layers: { status: 'confirmed' },
    controls: { status: 'confirmed' },
    endState: { status: 'missing' },
  },
  readiness: {
    score: 100,
    level: 'ready',
    confirmedSlots: ['trigger', 'branches', 'sequence', 'integrationModes', 'assets', 'layers', 'controls', 'endState'],
    inferredSlots: [],
    missingSlots: [],
    waivedSlots: [],
    riskSummary: 'AI 误判为全部确认。',
  },
})

assert(contradictoryReadinessSpec?.readiness?.level === 'risk', 'readiness should be recalculated from slot status')
assert(contradictoryReadinessSpec?.readiness?.score === 88, 'readiness score should follow the 8-slot calculation')
assert(
  contradictoryReadinessSpec?.readiness?.missingSlots.includes('endState'),
  'readiness missing slots should not be overwritten by contradictory AI output',
)

const confirmedSpec = normalizePerformanceSpec({
  detected: true,
  source: 'ai',
  confidence: 90,
  eventTypes: ['弹窗/揭晓表现'],
  integrationModes: ['组件/弹窗特效'],
  trigger: '点击奖励按钮',
  branches: ['普通奖励和大奖分支'],
  sequence: [{ title: '弹窗入场', detail: '播放 prefab 入场' }],
  assets: ['reward_popup'],
  layers: ['PopUp'],
  controls: ['点击关闭'],
  endState: '关闭后恢复主界面输入',
  openQuestions: [],
  prototypeNotes: [],
  slotStatus: {
    trigger: { status: 'confirmed' },
    branches: { status: 'confirmed' },
    sequence: { status: 'confirmed' },
    integrationModes: { status: 'confirmed' },
    assets: { status: 'confirmed' },
    layers: { status: 'confirmed' },
    controls: { status: 'confirmed' },
    endState: { status: 'confirmed' },
  },
})

assert(confirmedSpec?.readiness?.level === 'ready', 'fully confirmed spec should be ready')
assert(confirmedSpec.blockingQuestion === null, 'fully confirmed spec should not have blocking question')

const riskMarkdown = formatPerformanceSpecMarkdown(legacySpec)
assert(riskMarkdown.includes('表现确认状态'), 'export markdown should include performance confirmation state')
assert(riskMarkdown.includes('仍待确认'), 'export markdown should list missing performance slots')

const waivedSpec = createNoSpecialPerformanceSpec('该节点只需要基础 UI 状态，无需额外动效。')
assert(waivedSpec.readiness?.level === 'waived', 'waived no-special spec should be marked waived')
assert(waivedSpec.blockingQuestion === null, 'waived no-special spec should not keep blocking question')
assert(
  formatPerformanceSpecMarkdown(waivedSpec).includes('该节点只需要基础 UI 状态，无需额外动效。'),
  'waived markdown should include waiver reason',
)

console.log('performanceOrchestration.test.ts: all assertions passed')
