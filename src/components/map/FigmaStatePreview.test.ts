import { figmaPreviewImages, figmaPreviewsWithStateFallback } from './FigmaStatePreview'
import type { PrdNode } from '../../types/prdNode'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function makeNode(patch: Partial<PrdNode>): PrdNode {
  return {
    id: 'page-a',
    parentId: null,
    label: 'Page A',
    summary: '',
    content: '',
    type: 'page',
    status: 'pending',
    level: 1,
    order: 0,
    needsPolish: true,
    extractedFrom: null,
    techNotes: null,
    children: [],
    ...patch,
  }
}

const stateOnlyNode = makeNode({
  uiStates: [
    {
      id: 'state-default',
      label: 'Default',
      kind: 'default',
      figmaNodeId: '1:1',
      sourceUrl: 'https://www.figma.com/design/file/test?node-id=1-1',
      previewImageUrl: '/assets/state-default.png',
      visibleTexts: [],
      annotations: [],
      confidence: 90,
    },
  ],
})

const fallbackPreviews = figmaPreviewsWithStateFallback(stateOnlyNode)
assertEqual(fallbackPreviews.length, 1, 'ui state preview image should create a fallback preview')
assertEqual(fallbackPreviews[0]?.nodeId, '1:1', 'fallback preview keeps figma node id')
assertEqual(fallbackPreviews[0]?.imageUrl, '/assets/state-default.png', 'fallback preview uses state preview image')
assertEqual(fallbackPreviews[0]?.isPrimary, true, 'default state fallback becomes primary when no primary exists')
assertEqual(figmaPreviewImages(stateOnlyNode).length, 1, 'state-only node should be previewable')

const duplicateNode = makeNode({
  figmaPreviews: [
    {
      nodeId: '1:1',
      name: 'Default',
      sourceUrl: 'https://www.figma.com/design/file/test?node-id=1-1',
      imageUrl: '/assets/state-default.png',
      width: 375,
      height: 812,
      isPrimary: true,
    },
  ],
  uiStates: stateOnlyNode.uiStates,
})

assertEqual(figmaPreviewsWithStateFallback(duplicateNode).length, 1, 'state fallback should not duplicate existing figma previews')
assertEqual(figmaPreviewImages(duplicateNode).length, 1, 'deduped previews should remain previewable once')

console.log('FigmaStatePreview.test.ts: all assertions passed')

