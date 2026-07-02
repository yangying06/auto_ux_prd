import assert from 'node:assert/strict'
import {
  exportDepthHint,
  exportDepthLabel,
  filterDeliveryNodesByDepth,
  isExportableDeliveryNode,
} from '../src/lib/prdNodeDelivery'
import type { PrdNode, PrdTree } from '../src/types/prdNode'

function node(overrides: Partial<PrdNode>): PrdNode {
  return {
    id: overrides.id ?? 'PAGE-TEST',
    parentId: overrides.parentId ?? null,
    label: overrides.label ?? '测试页面',
    summary: overrides.summary ?? '',
    content: overrides.content ?? '',
    type: overrides.type ?? 'page',
    status: overrides.status ?? 'done',
    level: overrides.level ?? 0,
    order: overrides.order ?? 0,
    needsPolish: overrides.needsPolish ?? false,
    extractedFrom: overrides.extractedFrom ?? null,
    techNotes: overrides.techNotes ?? null,
    children: overrides.children ?? [],
    ...overrides,
  }
}

{
  const placeholder = node({
    id: 'PAGE-MAIN',
    label: '???',
    summary: '????????',
    content: '????\n???????',
  })
  const tree: PrdTree = { [placeholder.id]: placeholder }

  assert.equal(isExportableDeliveryNode(placeholder, tree), false, 'placeholder page should not be exportable')
  assert.deepEqual(filterDeliveryNodesByDepth([placeholder], 'all', tree), [], 'placeholder page should be filtered even in all mode')
}

{
  const figmaNode = node({
    id: 'PAGE-FIGMA-01',
    label: 'AI 礼物入口',
    summary: '来自 Figma 的确定性界面节点。',
    figmaPreviews: [{
      nodeId: '1:2',
      name: 'AI 礼物入口',
      sourceUrl: '',
      imageUrl: null,
      width: 750,
      height: 1624,
    }],
  })
  const tree: PrdTree = { [figmaNode.id]: figmaNode }

  assert.equal(isExportableDeliveryNode(figmaNode, tree), true, 'Figma-backed page should remain exportable')
  assert.deepEqual(filterDeliveryNodesByDepth([figmaNode], 'all', tree).map((item) => item.id), ['PAGE-FIGMA-01'])
}

assert.equal(exportDepthLabel('done'), '仅已确认')
assert.equal(exportDepthLabel('forged'), '含免打磨')
assert.equal(exportDepthLabel('all'), '全部文档包')
assert.match(exportDepthHint('all'), /有效内容或证据/u)

console.log('prdNodeDelivery tests passed')
