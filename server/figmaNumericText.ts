import { deflateSync, inflateSync } from 'node:zlib'

export interface FigmaNumericTextBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface FigmaNumericTextNode {
  id: string
  name: string
  type: string
  visible?: boolean
  characters?: string
  absoluteBoundingBox?: FigmaNumericTextBounds
  absoluteRenderBounds?: FigmaNumericTextBounds | null
  children?: FigmaNumericTextNode[]
}

export interface FigmaNumericTextSlot {
  slotId: string
  nodeId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface DecodedPng {
  width: number
  height: number
  bitDepth: number
  colorType: number
  channels: number
  pixels: Uint8Array
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const CRC_TABLE = makeCrcTable()

function normalizeNumberishText(value: string) {
  return value
    .trim()
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[，]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[％]/g, '%')
    .replace(/\s+/g, '')
}

export function isNumericFigmaText(value: string | null | undefined) {
  const text = normalizeNumberishText(value ?? '')
  if (!text || !/[0-9]/u.test(text)) return false

  const token = String.raw`[+\-−~≈]?[¥￥$€£]?\d+(?:,\d{3})*(?:\.\d+)?(?:%|[kKmMwW]|万|亿|千|百|点|级|元|金币|钻石|枚|个|次|分|秒|天)?`
  const numericSequence = new RegExp(String.raw`^(?:${token})(?:[/:：\-](?:${token}))*$`, 'u')
  return numericSequence.test(text)
    || /^(?:x|X|×)[+\-−]?\d+(?:\.\d+)?$/u.test(text)
    || /^Lv\.?\d+$/iu.test(text)
    || /^VIP\d+$/iu.test(text)
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function figmaNodeBounds(node: FigmaNumericTextNode): Rect | null {
  const bounds = node.absoluteBoundingBox ?? node.absoluteRenderBounds
  const width = finiteNumber(bounds?.width) ?? 0
  const height = finiteNumber(bounds?.height) ?? 0
  if (width <= 0 || height <= 0) return null
  return {
    x: finiteNumber(bounds?.x) ?? 0,
    y: finiteNumber(bounds?.y) ?? 0,
    width,
    height,
  }
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

export function collectFigmaNumericTextSlots(candidate: FigmaNumericTextNode): FigmaNumericTextSlot[] {
  const initialBounds = figmaNodeBounds(candidate)
  if (!initialBounds) return []
  const candidateBounds: Rect = initialBounds

  const rawSlots: Array<Omit<FigmaNumericTextSlot, 'slotId'>> = []

  function walk(node: FigmaNumericTextNode) {
    if (node.visible === false) return

    if (node.type === 'TEXT' && isNumericFigmaText(node.characters ?? node.name)) {
      const bounds = figmaNodeBounds(node)
      const clipped = bounds ? intersectRect(bounds, candidateBounds) : null
      if (clipped) {
        const x = clipped.x - candidateBounds.x
        const y = clipped.y - candidateBounds.y
        rawSlots.push({
          nodeId: node.id,
          name: node.name || 'numeric text',
          x: round1(x),
          y: round1(y),
          width: round1(clipped.width),
          height: round1(clipped.height),
          centerX: round1(x + clipped.width / 2),
          centerY: round1(y + clipped.height / 2),
        })
      }
    }

    for (const child of node.children ?? []) {
      walk(child)
    }
  }

  walk(candidate)
  return rawSlots
    .sort((a, b) => a.y - b.y || a.x - b.x || a.nodeId.localeCompare(b.nodeId))
    .map((slot, index) => ({ ...slot, slotId: `num-${index + 1}` }))
}

export function redactNumericTextFromPng(
  bytes: Uint8Array,
  slots: FigmaNumericTextSlot[],
  designSize: { width: number; height: number },
) {
  if (!slots.length || designSize.width <= 0 || designSize.height <= 0) return bytes

  try {
    const png = decodePng(bytes)
    if (!png || png.bitDepth !== 8 || ![0, 2, 4, 6].includes(png.colorType)) return bytes

    for (const slot of slots) {
      const xScale = png.width / designSize.width
      const yScale = png.height / designSize.height
      const rect = {
        x: Math.floor(slot.x * xScale) - 2,
        y: Math.floor(slot.y * yScale) - 2,
        width: Math.ceil(slot.width * xScale) + 4,
        height: Math.ceil(slot.height * yScale) + 4,
      }
      paintRectWithSampledBackground(png, rect)
    }

    return encodePng(png)
  } catch (error) {
    console.warn('[figma] numeric text PNG redaction failed:', error)
    return bytes
  }
}

function decodePng(bytes: Uint8Array): DecodedPng | null {
  if (bytes.length < PNG_SIGNATURE.length) return null
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null
  }

  let offset = PNG_SIGNATURE.length
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let compression = 0
  let filter = 0
  let interlace = 0
  const idatParts: Uint8Array[] = []

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
      bitDepth = data[8]
      colorType = data[9]
      compression = data[10]
      filter = data[11]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idatParts.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  if (!width || !height || bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) return null
  const channels = channelsForColorType(colorType)
  if (!channels) return null

  const rowBytes = width * channels
  const inflated = inflateSync(Buffer.concat(idatParts.map((part) => Buffer.from(part))))
  if (inflated.length < height * (rowBytes + 1)) return null

  const pixels = new Uint8Array(width * height * channels)
  let sourceOffset = 0
  let targetOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[sourceOffset]
    sourceOffset += 1
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceOffset]
      sourceOffset += 1
      const left = x >= channels ? pixels[targetOffset - channels] : 0
      const up = y > 0 ? pixels[targetOffset - rowBytes] : 0
      const upLeft = y > 0 && x >= channels ? pixels[targetOffset - rowBytes - channels] : 0
      pixels[targetOffset] = (raw + pngFilterPredictor(filterType, left, up, upLeft)) & 0xff
      targetOffset += 1
    }
  }

  return { width, height, bitDepth, colorType, channels, pixels }
}

function encodePng(png: DecodedPng) {
  const rowBytes = png.width * png.channels
  const scanlines = Buffer.alloc(png.height * (rowBytes + 1))
  let offset = 0
  for (let y = 0; y < png.height; y += 1) {
    scanlines[offset] = 0
    offset += 1
    scanlines.set(png.pixels.subarray(y * rowBytes, (y + 1) * rowBytes), offset)
    offset += rowBytes
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(png.width, 0)
  ihdr.writeUInt32BE(png.height, 4)
  ihdr[8] = png.bitDepth
  ihdr[9] = png.colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(scanlines)),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

function channelsForColorType(colorType: number) {
  if (colorType === 0) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  if (colorType === 6) return 4
  return null
}

function pngFilterPredictor(filterType: number, left: number, up: number, upLeft: number) {
  if (filterType === 0) return 0
  if (filterType === 1) return left
  if (filterType === 2) return up
  if (filterType === 3) return Math.floor((left + up) / 2)
  if (filterType === 4) return paethPredictor(left, up, upLeft)
  throw new Error(`Unsupported PNG filter type: ${filterType}`)
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  if (upDistance <= upLeftDistance) return up
  return upLeft
}

function paintRectWithSampledBackground(png: DecodedPng, rawRect: Rect) {
  const rect = clampRect(rawRect, png.width, png.height)
  if (rect.width <= 0 || rect.height <= 0) return

  const fill = sampleBackground(png, rect)
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * png.width + x) * png.channels
      for (let channel = 0; channel < png.channels; channel += 1) {
        png.pixels[offset + channel] = fill[channel] ?? 0
      }
    }
  }
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  const left = Math.max(0, Math.min(width, rect.x))
  const top = Math.max(0, Math.min(height, rect.y))
  const right = Math.max(left, Math.min(width, rect.x + rect.width))
  const bottom = Math.max(top, Math.min(height, rect.y + rect.height))
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function sampleBackground(png: DecodedPng, rect: Rect) {
  const totals = Array.from({ length: png.channels }, () => 0)
  let count = 0
  const samplePixel = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return
    const offset = (y * png.width + x) * png.channels
    for (let channel = 0; channel < png.channels; channel += 1) {
      totals[channel] += png.pixels[offset + channel]
    }
    count += 1
  }

  const left = rect.x - 1
  const right = rect.x + rect.width
  const top = rect.y - 1
  const bottom = rect.y + rect.height
  for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    samplePixel(x, top)
    samplePixel(x, bottom)
  }
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    samplePixel(left, y)
    samplePixel(right, y)
  }

  if (count === 0) {
    const fallbackOffset = (rect.y * png.width + rect.x) * png.channels
    return Array.from({ length: png.channels }, (_, channel) => png.pixels[fallbackOffset + channel] ?? 0)
  }

  return totals.map((total) => Math.round(total / count))
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
