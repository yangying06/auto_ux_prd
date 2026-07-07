import assert from 'node:assert/strict'
import { buildPrdImageEvidenceInstruction, normalizeDecompositionSourceImages, normalizeDecompositionSources } from './sources'

const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

const normalizedImages = normalizeDecompositionSourceImages([
  {
    name: 'lark-screenshot.png',
    mediaType: 'image/png',
    data: png1x1,
    sourceUrl: 'https://example.com/image.png',
  },
], 4)

assert.equal(normalizedImages.length, 1, 'valid source image is normalized')
assert.equal(normalizedImages[0]?.mediaType, 'image/png')

const normalizedFigmaPrdOnly = normalizeDecompositionSources({
  figmaPrdUrl: 'https://www.figma.com/design/example/File?node-id=1-2',
}, 4)

assert.equal(normalizedFigmaPrdOnly.figmaUrl, null, 'regular Figma design URL remains separate')
assert.equal(normalizedFigmaPrdOnly.figmaPrdUrl, 'https://www.figma.com/design/example/File?node-id=1-2', 'Figma PRD canvas URL is accepted as its own source')

const instruction = buildPrdImageEvidenceInstruction([
  {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: png1x1,
    },
  },
], '整份 PRD')

assert.ok(instruction.includes('Figma 截图'), 'image evidence prompt names Figma screenshots as a source')
assert.ok(instruction.includes('飞书文档图片'), 'image evidence prompt keeps Lark image context')
assert.ok(instruction.includes('导入图片资料'), 'image evidence prompt keeps user-imported image index context')

console.log('sources.test.ts: all assertions passed')
