import assert from 'node:assert/strict'
import { deflateSync, inflateSync } from 'node:zlib'
import {
  collectFigmaNumericTextSlots,
  isNumericFigmaText,
  redactNumericTextFromPng,
} from './figmaNumericText'
import type { FigmaNumericTextSlot } from './figmaNumericText'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CRC_TABLE = makeCrcTable()

assert.equal(isNumericFigmaText('12,345'), true, 'plain numeric text is redacted')
assert.equal(isNumericFigmaText('￥99.00'), true, 'currency numeric text is redacted')
assert.equal(isNumericFigmaText('75%'), true, 'percentage numeric text is redacted')
assert.equal(isNumericFigmaText('x3'), true, 'multiplier numeric text is redacted')
assert.equal(isNumericFigmaText('剩余12次'), false, 'mixed explanatory copy is not treated as a numeric-only slot')

const slots = collectFigmaNumericTextSlots({
  id: 'frame',
  name: 'Panel',
  type: 'FRAME',
  absoluteBoundingBox: { x: 100, y: 200, width: 300, height: 600 },
  children: [
    {
      id: 'text-1',
      name: 'Coin Amount',
      type: 'TEXT',
      characters: '999',
      absoluteBoundingBox: { x: 120, y: 250, width: 44, height: 18 },
    },
    {
      id: 'text-2',
      name: 'Label',
      type: 'TEXT',
      characters: '金币奖励',
      absoluteBoundingBox: { x: 120, y: 280, width: 80, height: 18 },
    },
  ],
})

assert.deepEqual(slots, [
  {
    slotId: 'num-1',
    nodeId: 'text-1',
    name: 'Coin Amount',
    x: 20,
    y: 50,
    width: 44,
    height: 18,
    centerX: 42,
    centerY: 59,
  },
], 'numeric slots are returned in frame-relative coordinates')

const rgba = Buffer.alloc(8 * 8 * 4, 255)
for (let y = 2; y < 4; y += 1) {
  for (let x = 2; x < 4; x += 1) {
    const offset = (y * 8 + x) * 4
    rgba[offset] = 0
    rgba[offset + 1] = 0
    rgba[offset + 2] = 0
    rgba[offset + 3] = 255
  }
}

const redactionSlot: FigmaNumericTextSlot = {
  slotId: 'num-1',
  nodeId: 'text-1',
  name: 'Amount',
  x: 2,
  y: 2,
  width: 2,
  height: 2,
  centerX: 3,
  centerY: 3,
}
const redacted = redactNumericTextFromPng(makeRgbaPng(8, 8, rgba), [redactionSlot], { width: 8, height: 8 })
const redactedPixels = decodeRgbaPng(redacted)
assert.deepEqual(
  Array.from(redactedPixels.subarray((2 * 8 + 2) * 4, (2 * 8 + 2) * 4 + 4)),
  [255, 255, 255, 255],
  'numeric text pixels are painted with nearby background color',
)

console.log('figmaNumericText.test.ts: all assertions passed')

function makeRgbaPng(width: number, height: number, pixels: Uint8Array) {
  const rowBytes = width * 4
  const scanlines = Buffer.alloc(height * (rowBytes + 1))
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    scanlines[offset] = 0
    offset += 1
    scanlines.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), offset)
    offset += rowBytes
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(scanlines)),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

function decodeRgbaPng(bytes: Uint8Array) {
  let offset = PNG_SIGNATURE.length
  let width = 0
  let height = 0
  const parts: Uint8Array[] = []
  while (offset + 12 <= bytes.length) {
    const length = readUInt32(bytes, offset)
    offset += 4
    const type = Buffer.from(bytes.subarray(offset, offset + 4)).toString('ascii')
    offset += 4
    const data = bytes.subarray(offset, offset + length)
    offset += length + 4
    if (type === 'IHDR') {
      width = readUInt32(data, 0)
      height = readUInt32(data, 4)
    } else if (type === 'IDAT') {
      parts.push(data)
    } else if (type === 'IEND') {
      break
    }
  }
  const rowBytes = width * 4
  const inflated = inflateSync(Buffer.concat(parts.map((part) => Buffer.from(part))))
  const pixels = Buffer.alloc(width * height * 4)
  let sourceOffset = 0
  let targetOffset = 0
  for (let y = 0; y < height; y += 1) {
    assert.equal(inflated[sourceOffset], 0, 'test fixture expects unfiltered rows')
    sourceOffset += 1
    inflated.copy(pixels, targetOffset, sourceOffset, sourceOffset + rowBytes)
    sourceOffset += rowBytes
    targetOffset += rowBytes
  }
  return pixels
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function makeChunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  chunk.set(data, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length)
  return chunk
}

function makeCrcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
