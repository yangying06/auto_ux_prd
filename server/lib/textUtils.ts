/**
 * Small text/markdown utility helpers.
 *
 * Extracted from server/index.ts.
 */

export function idSegmentFromTitle(title: string, fallback: string) {
  const ascii = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/_+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 20)
    .replace(/^-|-$/g, '')
    .toUpperCase()
  return ascii || fallback
}


export function estimateTextTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 2))
}


export function compactExcerpt(text: string, maxLength = 180) {
  const excerpt = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => line && !/^\|?\s*[-:]{3,}/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength)}...` : excerpt
}


export function countPattern(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}


export function countLinesMatching(text: string, pattern: RegExp) {
  return text.split(/\r?\n/).filter((line) => pattern.test(line)).length
}
