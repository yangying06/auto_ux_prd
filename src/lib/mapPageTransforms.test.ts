import {
  buildAddedNodePolishRequest,
  buildPrototypeFlowPreview,
  collectPendingFigmaDraftTargets,
  countFigmaBoundDeliveryNodes,
  shouldGenerateAddedNodeDocument,
} from './mapPageTransforms'
import { figmaDraftSourceKey } from './figmaDraftPrototype'
import { pickPrototypeFlowJumpEdge, prototypeFlowEdgeMatchesClick } from './prototypeFlowInteraction'
import type { PrdNode, PrdNodeReference, PrdTree } from '../types/prdNode'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function assertMatch(actual: string, pattern: RegExp, message: string) {
  if (!pattern.test(actual)) throw new Error(`${message}: ${pattern} not found in ${actual}`)
}

assertEqual(
  shouldGenerateAddedNodeDocument('', [], { text: '# PRD\n\n## 任务面板' }),
  true,
  'project PRD source is enough to trigger added-node document generation',
)

assertEqual(
  shouldGenerateAddedNodeDocument('', [], { text: '' }),
  false,
  'empty title-only additions without project source do not trigger AI polishing',
)

const request = buildAddedNodePolishRequest({
  title: '赛季任务面板',
  parentLabel: '活动中心',
  supplementText: '覆盖每日任务、奖励领取和空状态。',
  sources: [{ name: 'task.md', sourceKind: 'upload', text: '任务字段：id、progress、rewardStatus' }],
  hasProjectPrd: true,
})

assertMatch(request, /新增界面节点：赛季任务面板/u, 'request includes node title')
assertMatch(request, /父级节点：活动中心/u, 'request includes parent label')
assertMatch(request, /nodePatch\.summary/u, 'request forces a nodePatch document write')
assertMatch(request, /不是右侧 HTML 原型修改/u, 'request avoids prototype-only routing')
assertMatch(request, /视觉资源缺口/u, 'request prevents missing visuals from blocking the first document draft')
assertMatch(request, /任务字段/u, 'request carries attachment material')

const figmaNode: PrdNode = {
  id: 'figma-screen',
  parentId: null,
  label: 'Figma screen',
  summary: '',
  content: '',
  type: 'page',
  status: 'pending',
  level: 0,
  order: 0,
  needsPolish: true,
  extractedFrom: null,
  techNotes: null,
  children: [],
  uiStates: [
    {
      id: 'default',
      label: 'Default',
      kind: 'default',
      figmaNodeId: '1:1',
      sourceUrl: 'https://www.figma.com/design/file-a/test?node-id=1-1',
      previewImageUrl: null,
      visibleTexts: [],
      annotations: [],
      confidence: 80,
    },
    {
      id: 'error',
      label: 'Error',
      kind: 'error',
      figmaNodeId: '2:2',
      sourceUrl: 'https://www.figma.com/design/file-a/test?node-id=2-2',
      previewImageUrl: null,
      visibleTexts: [],
      annotations: [],
      confidence: 75,
    },
  ],
}

const figmaTree: PrdTree = { [figmaNode.id]: figmaNode }
const emptyPrototypeState = {
  prototypeHtml: '<html></html>',
  prototypeHistory: [],
  prototypeVariants: [],
  selectedVariantIndex: -1,
  draftPrototypeSpec: null,
  standardPrototypeSpec: null,
  figmaDraftSourceKeys: [],
}
const allTargets = collectPendingFigmaDraftTargets(figmaTree, {})

assertEqual(countFigmaBoundDeliveryNodes(figmaTree), 2, 'Figma source count should include every node state')
assertEqual(allTargets.length, 2, 'pending Figma draft targets should be source-granular')
assertEqual(allTargets[0]?.source.label, 'Default', 'default state should be first pending target')
assertEqual(allTargets[1]?.source.label, 'Error', 'secondary state should remain pending')

const remainingTargets = collectPendingFigmaDraftTargets(figmaTree, {
  [figmaNode.id]: {
    ...emptyPrototypeState,
    figmaDraftSourceKeys: [figmaDraftSourceKey(allTargets[0]?.source)],
  },
})

assertEqual(remainingTargets.length, 1, 'completed source keys should only remove that source')
assertEqual(remainingTargets[0]?.source.label, 'Error', 'unprocessed sibling state should remain queued')

const inFlightTargets = collectPendingFigmaDraftTargets(figmaTree, {
  [figmaNode.id]: {
    ...emptyPrototypeState,
    prototypeVariants: [{ index: 0, html: null, status: 'streaming' }],
  },
})

assertEqual(inFlightTargets.length, 0, 'nodes with in-flight prototypes should not enqueue more Figma work')

function makePage(id: string, label: string, order: number, references: PrdNodeReference[] = []): PrdNode {
  return {
    id,
    parentId: null,
    label,
    summary: label,
    content: '',
    type: 'page',
    status: 'done',
    level: 2,
    order,
    needsPolish: false,
    extractedFrom: null,
    techNotes: null,
    children: [],
    references,
  }
}

function prototypeState(html: string) {
  return {
    prototypeHtml: html,
    prototypeHistory: [],
    prototypeVariants: [],
    selectedVariantIndex: -1,
    draftPrototypeSpec: null,
    standardPrototypeSpec: null,
    figmaDraftSourceKeys: [],
  }
}

const flowTree: PrdTree = {
  'PAGE-A': makePage('PAGE-A', 'Entry', 0, [
    { targetNodeId: 'PAGE-B', label: 'Open B', reason: 'Primary jump from entry', sourceNodeId: 'PAGE-A' },
    { targetNodeId: 'PAGE-D', label: 'Optional D', reason: 'Alternate jump from entry', sourceNodeId: 'PAGE-A' },
  ]),
  'PAGE-B': makePage('PAGE-B', 'List', 1, [
    { targetNodeId: 'PAGE-C', label: 'Open C', reason: 'Continue to detail', sourceNodeId: 'PAGE-B' },
  ]),
  'PAGE-C': makePage('PAGE-C', 'Detail', 2),
  'PAGE-D': makePage('PAGE-D', 'Help', 3),
}

const flowPreview = buildPrototypeFlowPreview(flowTree, {
  'PAGE-A': prototypeState('<main>Entry</main>'),
  'PAGE-B': prototypeState('<main>List</main>'),
  'PAGE-C': prototypeState('<main>Detail</main>'),
  'PAGE-D': prototypeState('<main>Help</main>'),
})

assertEqual(flowPreview.entryNodeId, 'PAGE-A', 'flow preview starts at the generated node without incoming links')
assertEqual(flowPreview.orderedNodeIds.join('>'), 'PAGE-A>PAGE-B>PAGE-C>PAGE-D', 'flow preview follows reference links before loose branches')
assertEqual(flowPreview.edges.length, 3, 'flow preview collects generated-node reference edges')

const entryStep = flowPreview.steps[0]
assertEqual(entryStep.node.id, 'PAGE-A', 'first flow step is the entry page')
assertEqual(entryStep.nextNodeId, 'PAGE-B', 'entry next step follows the primary ordered edge')
assertEqual(entryStep.nextEdge?.label ?? '', 'Open B', 'entry next step preserves the connection label')
assertEqual(entryStep.outgoing.length, 2, 'entry exposes alternate outgoing relation jumps')
assertEqual(entryStep.outgoing.some((edge) => edge.targetNodeId === 'PAGE-D' && edge.label === 'Optional D'), true, 'entry exposes branch jump to help page')

const clickButtonEdge = {
  id: 'edge-click-xxx',
  targetNodeId: 'PAGE-B',
  label: '\u70b9\u51fb xxx \u6309\u94ae\u540e\u8df3\u8f6c\u5230\u9875\u97622',
  reason: null,
}
const alternateButtonEdge = {
  id: 'edge-help',
  targetNodeId: 'PAGE-D',
  label: 'Open help',
  reason: 'Click help icon to open the support page',
}

assertEqual(prototypeFlowEdgeMatchesClick(clickButtonEdge, 'xxx'), true, 'flow click matcher extracts button text from Chinese relation labels')
assertEqual(prototypeFlowEdgeMatchesClick(clickButtonEdge, 'unrelated'), false, 'flow click matcher ignores unrelated controls')
assertEqual(
  pickPrototypeFlowJumpEdge([alternateButtonEdge, clickButtonEdge], 'xxx')?.targetNodeId ?? '',
  'PAGE-B',
  'flow click matcher picks the relation whose trigger matches the clicked control',
)
assertEqual(
  pickPrototypeFlowJumpEdge([alternateButtonEdge, clickButtonEdge], 'Help')?.targetNodeId ?? '',
  'PAGE-D',
  'flow click matcher supports English relation trigger text',
)

console.log('mapPageTransforms.test.ts: all assertions passed')
