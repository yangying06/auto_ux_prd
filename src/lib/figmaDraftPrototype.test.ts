import type { FigmaFrameImportResponse } from './api'
import {
  figmaDraftSourceKey,
  figmaImportToPrototypeImages,
  getNodeFigmaDraftSource,
  getNodeFigmaDraftSources,
  nodeHasGeneratedFigmaDraftSource,
} from './figmaDraftPrototype'
import type { ContentBlock, ImageBlock } from '../types/chat'
import type { PrdNode } from '../types/prdNode'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function makeImage(
  nodeId: string,
  depth: number,
  data: string,
): FigmaFrameImportResponse['images'][number] {
  return {
    nodeId,
    name: nodeId,
    type: depth === 0 ? 'FRAME' : 'GROUP',
    width: 375,
    height: 812,
    depth,
    mediaType: 'image/png',
    data,
    assetPath: `${nodeId}.png`,
    assetUrl: `/api/figma/assets/test/${nodeId}.png`,
    numericTextSlots: [],
  }
}

function assertImageBlock(block: ContentBlock | undefined, message: string): ImageBlock {
  if (!block || block.type !== 'image') throw new Error(message)
  return block
}

const result: FigmaFrameImportResponse = {
  fileKey: 'file-a',
  nodeId: '1:1',
  panelName: 'Test Frame',
  sourceUrl: 'https://www.figma.com/design/file-a/test?node-id=1-1',
  summary: 'test',
  imageCount: 4,
  images: [
    makeImage('child-a', 1, 'aaaa'),
    makeImage('root', 0, 'rrrrr'),
    makeImage('child-b', 1, 'bbbb'),
    makeImage('child-c', 2, 'cccc'),
  ],
}

const selected = figmaImportToPrototypeImages(result, { maxImages: 3, maxDataChars: 12 })

assertEqual(selected.length, 2, 'selection should skip images that exceed the data budget')
assertEqual(selected[0]?.type, 'image', 'first selected block should be an image')
assertEqual(assertImageBlock(selected[0], 'first selected block should be an image').source.data, 'rrrrr', 'root frame should be prioritized')
assertEqual(assertImageBlock(selected[1], 'second selected block should be an image').source.data, 'aaaa', 'first eligible child should be retained')

const oversizedRoot = figmaImportToPrototypeImages(
  { ...result, images: [makeImage('root-large', 0, 'rrrrrrrrrrrrr'), makeImage('child', 1, 'c')] },
  { maxImages: 2, maxDataChars: 4 },
)

assertEqual(oversizedRoot.length, 1, 'the root image should be retained even when it exceeds the budget alone')
assertEqual(assertImageBlock(oversizedRoot[0], 'oversized root block should be an image').source.data, 'rrrrrrrrrrrrr', 'oversized root image should still be sent')

const nodeWithStates: PrdNode = {
  id: 'screen-a',
  parentId: null,
  label: 'Screen A',
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
      id: 'variant',
      label: 'Variant state',
      kind: 'variant',
      figmaNodeId: '2:2',
      sourceUrl: 'https://www.figma.com/design/file-a/test?node-id=2-2',
      previewImageUrl: null,
      visibleTexts: [],
      annotations: [],
      confidence: 99,
    },
    {
      id: 'default',
      label: 'Default state',
      kind: 'default',
      figmaNodeId: '1:1',
      sourceUrl: 'https://www.figma.com/design/file-a/test?node-id=1-1',
      previewImageUrl: null,
      visibleTexts: [],
      annotations: [],
      confidence: 80,
    },
  ],
  figmaPreviews: [
    {
      nodeId: '3:3',
      name: 'Preview state',
      sourceUrl: 'https://www.figma.com/design/file-a/test?node-id=3-3',
      imageUrl: null,
      width: 375,
      height: 812,
      isPrimary: true,
    },
    {
      nodeId: '1:1',
      name: 'Duplicate preview',
      sourceUrl: 'https://www.figma.com/design/file-a/test?node-id=1-1',
      imageUrl: null,
      width: 375,
      height: 812,
      isPrimary: false,
    },
  ],
}

const sources = getNodeFigmaDraftSources(nodeWithStates)

assertEqual(sources.length, 3, 'all unique Figma states and previews should be collected')
assertEqual(sources[0]?.label, 'Default state', 'default UI state should be generated first')
assertEqual(sources[1]?.label, 'Variant state', 'remaining UI states should follow by confidence')
assertEqual(sources[2]?.label, 'Preview state', 'deduplicated figma previews should follow UI states')
assertEqual(getNodeFigmaDraftSource(nodeWithStates)?.label, 'Default state', 'single-source helper should preserve the best source')

const variantKey = figmaDraftSourceKey(sources[1])
assertEqual(
  nodeHasGeneratedFigmaDraftSource({ figmaDraftSourceKeys: [variantKey] }, sources[1]),
  true,
  'generated source keys should mark individual Figma states as complete',
)
assertEqual(
  nodeHasGeneratedFigmaDraftSource({ figmaDraftSourceKeys: [variantKey] }, sources[0]),
  false,
  'source completion should not mark sibling states as complete',
)

console.log('figmaDraftPrototype.test.ts: all assertions passed')
