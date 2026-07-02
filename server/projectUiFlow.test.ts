import assert from 'node:assert/strict'
import { buildProjectUiFlow } from './projectUiFlow'
import type { FigmaUxMap } from '../src/types/prdNode'

function group(key: string, label: string, frameId = key) {
  return {
    key,
    label,
    frames: [
      {
        id: frameId,
        name: label,
        visibleTexts: [label],
        annotations: [],
      },
    ],
  }
}

const linearMap: FigmaUxMap = {
  version: 'figma-ux-map.v1',
  review: { source: 'heuristic', confidence: 90, notes: [] },
  screens: [
    { id: 'screen-start', groupKey: 'start', label: '开始页面', sourceFrameIds: ['start-frame'], stateIds: [], evidence: [], confidence: 92 },
    { id: 'screen-confirm', groupKey: 'confirm', label: '确认页面', sourceFrameIds: ['confirm-frame'], stateIds: [], evidence: [], confidence: 90 },
    { id: 'screen-done', groupKey: 'done', label: '完成页面', sourceFrameIds: ['done-frame'], stateIds: [], evidence: [], confidence: 91 },
  ],
  states: [],
  transitions: [
    {
      id: 'transition-start-confirm',
      sourceScreenId: 'screen-start',
      targetScreenId: 'screen-confirm',
      trigger: '点击开始',
      condition: null,
      effect: '进入确认页面',
      evidence: ['Figma connector start -> confirm'],
      confidence: 94,
      source: 'figma_connector',
    },
    {
      id: 'transition-confirm-done',
      sourceScreenId: 'screen-confirm',
      targetScreenId: 'screen-done',
      trigger: '点击确认',
      condition: null,
      effect: '进入完成页面',
      evidence: ['Figma connector confirm -> done'],
      confidence: 93,
      source: 'figma_connector',
    },
  ],
  ambiguities: [],
}

{
  const flow = buildProjectUiFlow({
    groups: [
      group('start', '开始页面', 'start-frame'),
      group('confirm', '确认页面', 'confirm-frame'),
      group('done', '完成页面', 'done-frame'),
    ],
    figmaUxMap: linearMap,
  })

  assert.ok(flow, 'linear Figma transition path creates a flow')
  assert.deepEqual(flow.entryNodeIds, ['screen-start'])
  assert.deepEqual(flow.exitNodeIds, ['screen-done'])
  assert.deepEqual(flow.happyPathNodeIds, ['screen-start', 'screen-confirm', 'screen-done'])
  assert.equal(flow.edges.length, 2)
  assert.equal(flow.ambiguities.length, 0)
}

{
  const flow = buildProjectUiFlow({
    groups: [
      group('start', '开始页面'),
      group('confirm', '确认页面'),
    ],
    figmaRelations: [
      {
        sourceGroupKey: 'start',
        targetGroupKey: 'confirm',
        label: 'Figma 连线',
        reason: 'vector connector',
        confidence: 72,
        source: 'figma_connector',
      },
    ],
    prdRelations: [
      {
        sourceGroupKey: 'start',
        targetGroupKey: 'confirm',
        label: 'PRD relation strengthens start-confirm',
        reason: 'PRD：开始后进入确认页面',
        confidence: 86,
        source: 'prd_relation',
      },
    ],
  })

  assert.ok(flow)
  assert.equal(flow.edges.length, 1, 'PRD relation strengthens existing edge instead of duplicating')
  assert.equal(flow.edges[0].source, 'mixed')
  assert.ok(flow.edges[0].confidence >= 86)
  assert.ok(flow.edges[0].evidenceRefs.some((ref) => ref.kind === 'prd'))
}

{
  const flow = buildProjectUiFlow({
    groups: [
      group('start', '开始页面'),
      group('done', '完成页面'),
      group('orphan', '孤立页面'),
    ],
    figmaRelations: [
      {
        sourceGroupKey: 'start',
        targetGroupKey: 'done',
        label: '点击完成',
        reason: 'only connected pair',
        confidence: 88,
        source: 'figma_connector',
      },
    ],
  })

  assert.ok(flow)
  assert.ok(flow.ambiguities.some((item) => item.kind === 'disconnected_node'), 'disconnected_node ambiguity is emitted')
}

{
  const flow = buildProjectUiFlow({
    groups: [
      group('start', '开始页面'),
      group('a', 'A 页面'),
      group('b', 'B 页面'),
      group('done', '完成页面'),
    ],
    figmaRelations: [
      { sourceGroupKey: 'start', targetGroupKey: 'a', label: '高置信路径', reason: 'connector', confidence: 91, source: 'figma_connector' },
      { sourceGroupKey: 'a', targetGroupKey: 'done', label: '完成', reason: 'connector', confidence: 91, source: 'figma_connector' },
      { sourceGroupKey: 'start', targetGroupKey: 'b', label: '低置信路径', reason: 'prd text', confidence: 74, source: 'prd_relation' },
      { sourceGroupKey: 'b', targetGroupKey: 'done', label: '完成', reason: 'prd text', confidence: 74, source: 'prd_relation' },
    ],
  })

  assert.ok(flow)
  assert.deepEqual(flow.happyPathNodeIds.map((id) => flow.nodes.find((node) => node.id === id)?.label), ['开始页面', 'A 页面', '完成页面'])
  assert.equal(flow.alternatePaths.length, 1, 'alternate lower-confidence path is preserved')
}

console.log('projectUiFlow tests passed')

