import assert from 'node:assert/strict'
import { buildProjectKnowledgeDocuments, searchProjectKnowledge, tokenizeKnowledgeText } from './projectKnowledgeIndex'
import type { ProjectSourceDocument } from '../src/types/archive'
import type { ChatMessage } from '../src/types/chat'
import type { PrdNode } from '../src/types/prdNode'

const sourceDocument: ProjectSourceDocument = {
  filename: 'sample-prd.md',
  importedAt: '2026-06-18T00:00:00.000Z',
  text: [
    '# 活动 PRD',
    '',
    '## 登录页',
    '手机号输入错误时展示红色错误提示，并保留已输入内容。',
    '',
    '## 奖励弹窗',
    '领取成功后展示奖励弹窗，包含金币数量和继续按钮。',
  ].join('\n'),
}

const tree: Record<string, PrdNode> = {
  PAGE_REWARD: {
    id: 'PAGE_REWARD',
    parentId: null,
    label: '奖励弹窗',
    summary: '领取成功后的奖励展示。',
    content: '展示金币数量、继续按钮和关闭行为。',
    type: 'page',
    status: 'pending_refine',
    level: 1,
    order: 0,
    needsPolish: true,
    extractedFrom: 'sample-prd.md',
    techNotes: null,
    children: [],
    docPath: 'pages/reward.md',
    audience: 'client',
    specLens: 'view',
    sections: {
      interaction: {
        summary: '点击继续按钮后关闭弹窗并回到活动页。',
        content: '继续按钮需要防重复点击。',
        evidenceRefs: [{ sourceKind: 'prd', sourceLabel: '奖励弹窗', quote: '包含金币数量和继续按钮' }],
      },
    },
    handoffGoal: '打磨奖励弹窗交互规格。',
    qualityGate: '奖励数量、关闭行为和异常态清晰。',
    backendContracts: [{
      title: '奖励领取结果',
      kind: 'api',
      summary: '返回金币数量和领取状态。',
      fields: ['coinAmount', 'claimStatus'],
      evidenceRefs: [{ sourceKind: 'prd', sourceLabel: '奖励弹窗', quote: '金币数量' }],
    }],
    references: [],
    evidenceRefs: [{ sourceKind: 'prd', sourceLabel: '奖励弹窗', quote: '领取成功后展示奖励弹窗' }],
  },
}

const messages: ChatMessage[] = [
  { role: 'user', content: '继续按钮点击后要禁用 500ms，避免重复领取。' },
  { role: 'assistant', content: '已记录继续按钮防重复点击规则。' },
]

assert.ok(tokenizeKnowledgeText('奖励弹窗 coinAmount').includes('奖励'), 'tokenizes CJK terms')

const documents = buildProjectKnowledgeDocuments({
  tree,
  sourceDocument,
  messages,
  currentNodeId: 'PAGE_REWARD',
})
assert.ok(documents.some((document) => document.type === 'source'), 'indexes source PRD sections')
assert.ok(documents.some((document) => document.type === 'section'), 'indexes node sections')
assert.ok(documents.some((document) => document.type === 'chat'), 'indexes recent node chat')

const rewardResult = searchProjectKnowledge({
  query: '金币数量 奖励领取结果 coinAmount',
  tree,
  sourceDocument,
  messages,
  currentNodeId: 'PAGE_REWARD',
  limit: 3,
})
assert.equal(rewardResult.status, 'connected')
assert.ok(rewardResult.hits.some((hit) => hit.type === 'backend'), 'finds backend contract evidence')
assert.ok(rewardResult.references.length > 0, 'returns references for UI display')

const chatResult = searchProjectKnowledge({
  query: '继续按钮 防重复点击',
  tree,
  sourceDocument,
  messages,
  currentNodeId: 'PAGE_REWARD',
  limit: 5,
})
assert.ok(chatResult.hits.some((hit) => hit.type === 'chat'), 'finds recent chat confirmations')

console.log('projectKnowledgeIndex.test.ts: all assertions passed')
