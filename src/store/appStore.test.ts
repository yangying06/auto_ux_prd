import { useAppStore } from './appStore'
import type { PrdTree } from '../types/prdNode'
import type { PrototypeSpec } from '../types/prototypeSpec'

const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  const message = String(args[0] ?? '')
  if (message.includes('zustand persist middleware')) return
  originalWarn(...args)
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
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
      content: 'original page body',
      type: 'page',
      status: 'pending_refine',
      level: 1,
      order: 0,
      needsPolish: true,
      extractedFrom: null,
      techNotes: null,
      references: [],
      sections: {
        view: { title: 'View', summary: 'old view summary', content: 'old view content', openQuestions: ['view question'] },
        interaction: { title: 'Flow', summary: 'old flow summary', content: 'old flow content' },
        data: { title: 'Data', summary: 'old data summary', content: 'old data content' },
      },
      backendContracts: [],
      evidenceRefs: [],
      performanceSpec: null,
    },
  }
}

useAppStore.getState().setPrdTree(makeTree())
useAppStore.getState().applyNodePolish('page-a', {
  sections: {
    view: {},
    interaction: {},
    data: {},
  },
})

let node = useAppStore.getState().prdTree?.['page-a']
assertEqual(node?.sections?.view?.summary, 'old view summary', 'empty polish sections must keep view summary')
assertEqual(node?.sections?.interaction?.content, 'old flow content', 'empty polish sections must keep interaction content')
assertEqual(node?.sections?.data?.content, 'old data content', 'empty polish sections must keep data content')

useAppStore.getState().updateNode('page-a', {
  performanceSpec: {
    detected: false,
    source: 'user',
    confidence: 100,
    eventTypes: [],
    trigger: null,
    branches: [],
    sequence: [],
    assets: [],
    layers: [],
    controls: [],
    endState: null,
    openQuestions: [],
    prototypeNotes: [],
  },
})

node = useAppStore.getState().prdTree?.['page-a']
assertEqual(node?.label, 'Page A', 'performance-only update must not clear label')
assertEqual(node?.summary, 'old summary', 'performance-only update must not clear summary')
assertEqual(node?.content, 'original page body', 'performance-only update must not clear content')
assertEqual(node?.sections?.view?.summary, 'old view summary', 'performance-only update must not clear sections')

useAppStore.getState().updateNode('page-a', {
  figmaPreviews: [
    {
      nodeId: '22:1774',
      name: 'Main state',
      sourceUrl: 'https://www.figma.com/design/example?node-id=22-1774',
      imageUrl: '/assets/figma/main.png',
      width: 375,
      height: 812,
      isPrimary: true,
    },
  ],
})

node = useAppStore.getState().prdTree?.['page-a']
assertDeepEqual(node?.figmaPreviews, [
  {
    nodeId: '22:1774',
    name: 'Main state',
    sourceUrl: 'https://www.figma.com/design/example?node-id=22-1774',
    imageUrl: '/assets/figma/main.png',
    width: 375,
    height: 812,
    isPrimary: true,
  },
], 'figma preview update must persist through node patch sanitizer')

useAppStore.getState().updateNode('page-a', {
  sections: {
    interaction: {
      summary: 'new flow summary',
      openQuestions: [],
    },
  },
})

node = useAppStore.getState().prdTree?.['page-a']
assertEqual(node?.sections?.view?.summary, 'old view summary', 'partial update sections must keep untouched view')
assertEqual(node?.sections?.interaction?.summary, 'new flow summary', 'partial update sections must update target summary')
assertEqual(node?.sections?.interaction?.content, 'old flow content', 'partial update sections must preserve missing target content')
assertDeepEqual(node?.sections?.interaction?.openQuestions, [], 'substantive section patch may clear resolved questions')
assertEqual(node?.sections?.data?.summary, 'old data summary', 'partial update sections must keep untouched data')

const prototypeSpec: PrototypeSpec = {
  schemaVersion: 'prototype-spec.v1',
  id: 'draft:page-a:test',
  mode: 'draft',
  title: 'Page A 草稿原型 Spec',
  sourceNodeId: 'page-a',
  sourceNodeLabel: 'Page A',
  sourceSummary: 'old summary',
  sourceInputs: [],
  htmlRole: 'preview',
  intent: 'test',
  layout: { viewport: '375x812', structure: [], visualReferences: [] },
  components: [],
  states: [],
  interactions: [],
  performanceLogic: [],
  assetPolicy: { mode: 'open', allowedAssetRefs: [], forbidden: [], notes: [] },
  dataBindings: [],
  platformConstraints: [],
  acceptanceCriteria: [],
  openQuestions: [],
  updatedAt: '2026-06-22T00:00:00.000Z',
}

useAppStore.getState().setNodePrototypeSpec('page-a', 'draft', prototypeSpec)
assertEqual(
  useAppStore.getState().nodePrototypeStates['page-a']?.draftPrototypeSpec?.id,
  prototypeSpec.id,
  'node prototype state should store draft prototype spec',
)

console.warn = originalWarn
console.log('appStore.test.ts: all assertions passed')
