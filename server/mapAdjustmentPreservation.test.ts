import assert from 'node:assert/strict'
import { useAppStore } from '../src/store/appStore'
import type { MapAdjustmentOperation, PrdNodeOperationSuggestion, PrdTree } from '../src/types/prdNode'

const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  const message = String(args[0] ?? '')
  if (message.includes('zustand persist middleware')) return
  originalWarn(...args)
}

function makeTree(): PrdTree {
  return {
    root: {
      id: 'root',
      parentId: null,
      children: ['page-a'],
      label: 'Root',
      summary: 'root summary',
      content: 'root content',
      type: 'module',
      status: 'pending',
      level: 0,
      order: 0,
      needsPolish: false,
      extractedFrom: null,
      techNotes: null,
      references: [],
      sections: {},
      backendContracts: [],
      evidenceRefs: [],
      performanceSpec: null,
    },
    'page-a': {
      id: 'page-a',
      parentId: 'root',
      children: [],
      label: 'Page A',
      summary: 'old summary',
      content: 'original text',
      type: 'page',
      status: 'pending_refine',
      level: 1,
      order: 0,
      needsPolish: true,
      extractedFrom: null,
      techNotes: null,
      references: [],
      sections: {},
      backendContracts: [],
      evidenceRefs: [],
      performanceSpec: null,
    },
  }
}

useAppStore.getState().setPrdTree(makeTree())
useAppStore.getState().applyMapAdjustmentOperations([
  { type: 'delete_node', nodeId: 'page-a' },
  { type: 'update_node', nodeId: 'page-a', patch: { content: 'new feedback text', summary: 'new summary' } },
  { type: 'move_content', fromNodeId: 'page-a', toNodeId: 'root', content: 'original text' },
] satisfies MapAdjustmentOperation[])

const adjustedTree = useAppStore.getState().prdTree
assert.ok(adjustedTree?.['page-a'], 'delete_node must not remove existing document nodes')
assert.match(adjustedTree['page-a'].content, /original text/u, 'source node content must remain')
assert.match(adjustedTree['page-a'].content, /new feedback text/u, 'update_node must append feedback content')
assert.match(adjustedTree['page-a'].summary, /old summary/u, 'update_node must retain original summary')
assert.match(adjustedTree['page-a'].summary, /new summary/u, 'update_node must append feedback summary')
assert.match(adjustedTree.root.content, /original text/u, 'move_content must copy content to target')

useAppStore.getState().setPrdTree(makeTree())
const updateSuggestion: PrdNodeOperationSuggestion = {
  id: 'suggestion-update',
  operation: 'update',
  targetNodeId: 'page-a',
  parentId: null,
  patch: {
    content: 'suggested supplement',
    summary: 'suggested summary',
  },
  rationale: 'Regression coverage',
  confidence: 90,
  evidenceRefs: [],
  status: 'pending',
}

useAppStore.getState().setNodeOperationSuggestions('page-a', [updateSuggestion])
useAppStore.getState().applyNodeOperationSuggestion('page-a', 'suggestion-update')

const suggestionTree = useAppStore.getState().prdTree
assert.ok(suggestionTree?.['page-a'], 'node operation update must keep target node')
assert.match(suggestionTree['page-a'].content, /original text/u, 'node operation update must retain original content')
assert.match(suggestionTree['page-a'].content, /suggested supplement/u, 'node operation update must append content')
assert.match(suggestionTree['page-a'].summary, /old summary/u, 'node operation update must retain original summary')
assert.match(suggestionTree['page-a'].summary, /suggested summary/u, 'node operation update must append summary')

console.warn = originalWarn
console.log('mapAdjustmentPreservation.test.ts: all assertions passed')
