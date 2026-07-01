import assert from 'node:assert/strict'
import {
  buildFigmaPrdAlignment,
  extractFigmaPrdGroupTerms,
  normalizeAlignmentText,
  type FigmaPrdAlignmentGroup,
  type FigmaPrdAlignmentSection,
} from './figmaPrdAlignment'

assert.equal(normalizeAlignmentText('AI 礼物输入页面'), 'ai礼物输入界面')

const figmaGroups: FigmaPrdAlignmentGroup[] = [
  {
    key: 'gift-input',
    label: 'AI礼物输入页',
    frames: [
      {
        id: '11:1',
        name: 'AI礼物输入页_默认态',
        visibleTexts: ['输入祝福语', '选择收礼人', '生成礼物'],
        annotations: ['点击生成礼物后进入生成流程'],
        childNames: ['祝福语输入框', '礼物风格选择'],
      },
    ],
  },
  {
    key: 'inventory',
    label: '礼物背包',
    frames: [
      {
        id: '22:1',
        name: '礼物背包',
        visibleTexts: ['我的礼物', '赠送记录'],
        annotations: [],
      },
    ],
  },
]

const prdSections: FigmaPrdAlignmentSection[] = [
  {
    id: 'sec-create-flow',
    label: '2.1 创建礼物流程（第 12 行）',
    matchText: '创建礼物流程',
    text: [
      '# 创建礼物流程',
      '玩家选择收礼人后，需要输入祝福语并选择礼物风格。',
      '点击生成礼物时进入生成流程，成功后展示礼物预览。',
    ].join('\n'),
    headingBacked: true,
  },
  {
    id: 'sec-wallet',
    label: '3.1 支付钱包（第 50 行）',
    matchText: '支付钱包',
    text: '支付钱包展示余额、充值入口和支付失败提示。',
    headingBacked: true,
  },
]

const terms = extractFigmaPrdGroupTerms(figmaGroups[0]!)
assert.ok(terms.some((term) => term.normalized === '祝福语'), 'visible Figma text becomes an alignment term')
assert.ok(terms.some((term) => term.normalized === '礼物'), 'short domain terms are retained')

const alignment = buildFigmaPrdAlignment(figmaGroups, prdSections, { minScore: 30 })
const giftMatches = alignment.matchesByGroup.get('gift-input') ?? []
assert.equal(giftMatches[0]?.sectionId, 'sec-create-flow', 'Figma page can align to PRD flow section with a different title')
assert.ok(giftMatches[0]?.matchedTerms.includes('输入祝福语'), 'alignment keeps concrete evidence terms')
assert.ok(giftMatches[0]?.confidence && giftMatches[0].confidence >= 70, 'strong overlap has useful confidence')
assert.equal(alignment.matchesByGroup.get('inventory')?.length ?? 0, 0, 'unrelated Figma pages are not force-matched')
assert.ok(alignment.unmatchedSections.some((section) => section.id === 'sec-wallet'), 'unmatched PRD sections stay available')

console.log('figmaPrdAlignment.test.ts: all assertions passed')
