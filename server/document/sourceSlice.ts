/**
 * PRD source-text slicing helpers.
 *
 * Splits a markdown body into length-bounded slices used both by the document
 * source-index builder (fallback when there are no headings) and by the
 * decompose pipeline. Pure functions with no external deps.
 */
export interface PrdSourceSlice {
  label: string
  text: string
  startLine: number
  endLine: number
}

export function pushPrdSourceSlice(slices: PrdSourceSlice[], lines: string[], startLine: number) {
  const text = lines.join('\n').trim()
  if (!text) return
  slices.push({
    label: `第 ${startLine}-${startLine + lines.length - 1} 行`,
    text,
    startLine,
    endLine: startLine + lines.length - 1,
  })
}

export function splitLongSectionLines(lines: string[], startLine: number, targetLength: number) {
  const slices: PrdSourceSlice[] = []
  let current: string[] = []
  let currentStart = startLine
  let currentLength = 0

  lines.forEach((line, index) => {
    if (current.length && currentLength + line.length > targetLength) {
      pushPrdSourceSlice(slices, current, currentStart)
      current = []
      currentStart = startLine + index
      currentLength = 0
    }
    current.push(line)
    currentLength += line.length + 1
  })

  pushPrdSourceSlice(slices, current, currentStart)
  return slices
}