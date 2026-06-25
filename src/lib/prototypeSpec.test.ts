import type { ChatMessage } from '../types/chat'
import type { PrototypeAssetManifest } from '../types/prototypeAssets'
import type { PrdNode } from '../types/prdNode'
import type { UXRequirementState } from '../types/uxRequirement'
import { buildDraftPrototypeSpecFromNode, formatPrototypeSpecForPrompt, standardizePrototypeSpec } from './prototypeSpec'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function assertMatch(actual: string, expected: RegExp, message: string) {
  if (!expected.test(actual)) throw new Error(`${message}: ${actual}`)
}

function makeNode(): PrdNode {
  return {
    id: 'node-reward',
    parentId: null,
    label: '奖励结算',
    summary: '展示奖励结算弹窗和入账反馈',
    content: '点击领取后展示奖励弹窗，金币飞入资产栏。',
    type: 'ui',
    status: 'pending_refine',
    level: 1,
    order: 0,
    needsPolish: true,
    extractedFrom: null,
    techNotes: '移动端 375x812 预览。',
    children: [],
    sections: {
      interaction: {
        summary: '点击领取后播放奖励反馈',
        content: '领取按钮置灰，金币飞入资产栏，完成后刷新余额。',
        openQuestions: ['飞入金币数量是否固定？'],
      },
      data: {
        summary: '依赖奖励金额和余额字段',
        content: 'rewardAmount, balance',
      },
      view: {
        summary: '奖励弹窗覆盖主界面',
        content: '弹窗、奖励列表、领取按钮、余额栏',
      },
    },
    qualityGate: '领取后余额刷新且按钮不可重复点击。',
    performanceSpec: null,
  }
}

const requirementState: UXRequirementState = {
  trigger_condition: '点击领取按钮',
  sequence_rules: '弹窗出现；金币飞入；余额刷新',
  asset_dependencies: [{ type: 'ReferenceImage', path: 'reward.png', is_ready: true }],
  engine_constraints: 'H5 和客户端都可实现',
  ui_components: [],
  suggested_answers: [],
  completion_rate: 70,
  slot_confidence: { trigger_condition: 80, sequence_rules: 70, asset_dependencies: 60, engine_constraints: 60 },
  missing_reasons: { trigger_condition: null, sequence_rules: null, asset_dependencies: null, engine_constraints: null },
  next_question: null,
  performance_spec: {
    detected: true,
    source: 'user',
    confidence: 90,
    eventTypes: ['奖励反馈'],
    integrationModes: ['组件动画'],
    trigger: '点击领取按钮',
    branches: ['成功', '失败'],
    sequence: [{ title: '金币飞入', detail: '从弹窗飞到资产栏' }],
    assets: ['coin_fx'],
    layers: ['Popup', 'UIEffect'],
    controls: ['重复点击置灰'],
    endState: '余额刷新',
    openQuestions: [],
    prototypeNotes: ['HTML 预览需要展示阶段切换'],
  },
}

const manifest: PrototypeAssetManifest = {
  mode: 'strict',
  assets: [{
    id: 'coin',
    kind: 'effect_preview',
    name: 'coin_fx',
    url: 'http://127.0.0.1:8787/api/assets/effects/coin.webp',
    source: 'effect_asset',
  }],
  notes: ['只能使用资源库白名单资源'],
  reusableLogicAssets: [{
    id: 'logic-reward',
    name: '奖励反馈节奏',
    type: 'feedback_pattern',
    status: 'approved',
    reuseMode: 'reference',
    description: '奖励弹窗到入账反馈的节奏。',
    logic: '弹窗确认后播放金币飞入，再刷新余额。',
    usageGuidance: '确认目标资产栏位置。',
    tags: ['奖励'],
    source: {
      nodeId: 'node-old',
      nodeLabel: '历史奖励',
      field: 'prototypeSpec',
      excerpt: '金币飞入',
    },
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  }],
}

const messages: ChatMessage[] = [
  { role: 'user', content: '请先做一个草稿预览。' },
]

const draft = buildDraftPrototypeSpecFromNode(makeNode(), messages, requirementState, manifest)
assertEqual(draft.mode, 'draft', 'draft mode should be set')
assertEqual(draft.htmlRole, 'preview', 'HTML role should be preview')
assertMatch(draft.performanceLogic.join('\n'), /金币飞入/u, 'draft spec should include performance logic')
assertMatch(draft.assetPolicy.forbidden.join('\n'), /HTML 只用于预览/u, 'draft spec should state HTML preview role')

const standard = standardizePrototypeSpec(draft, manifest)
assertEqual(standard.mode, 'standard', 'standard mode should be set')
assertEqual(standard.standardizedFromSpecId, draft.id, 'standard spec should link to draft')
assertMatch(standard.performanceLogic.join('\n'), /奖励反馈节奏/u, 'standard spec should include approved reusable logic')
assertMatch(standard.assetPolicy.allowedAssetRefs.join('\n'), /coin_fx/u, 'standard spec should include allowed asset refs')
assertMatch(standard.assetPolicy.forbidden.join('\n'), /交付给端上的是本 spec/u, 'standard spec should state handoff artifact')

const prompt = formatPrototypeSpecForPrompt(standard)
assertMatch(prompt, /Prototype Spec/u, 'prompt should include spec heading')
assertMatch(prompt, /HTML 角色: preview/u, 'prompt should include HTML role')
assertMatch(prompt, /资源库标准 Spec/u, 'prompt should include standard mode')

console.log('prototypeSpec.test.ts: all assertions passed')
