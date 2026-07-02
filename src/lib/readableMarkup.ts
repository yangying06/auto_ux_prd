const HTML_TAG_RE = /<\/?[a-z][^>]*>/iu
const TABLE_RE = /<table\b[\s\S]*?<\/table>/giu
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/giu
const CELL_RE = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/giu
const LIST_RE = /<(ol|ul)\b[^>]*>([\s\S]*?)<\/\1>/giu
const LIST_ITEM_RE = /<li\b[^>]*>([\s\S]*?)<\/li>/giu
const HTML_TAG_GLOBAL_RE = /<\/?[a-z][^>]*>/giu

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '...',
  ldquo: '"',
  lsquo: "'",
  lt: '<',
  mdash: '-',
  nbsp: ' ',
  ndash: '-',
  quot: '"',
  rdquo: '"',
  rsquo: "'",
}

function decodeEntity(entity: string) {
  const lower = entity.toLowerCase()
  if (lower.startsWith('#x')) {
    const codePoint = Number.parseInt(lower.slice(2), 16)
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`
  }
  if (lower.startsWith('#')) {
    const codePoint = Number.parseInt(lower.slice(1), 10)
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`
  }
  return ENTITY_MAP[lower] ?? `&${entity};`
}

export function decodeHtmlEntities(input: string) {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (_match, entity: string) => decodeEntity(entity))
}

function hasHtmlTags(input: string) {
  return HTML_TAG_RE.test(input)
}

function attrValue(attrs: string, name: string) {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'iu').exec(attrs)
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

function replaceImages(input: string) {
  return input.replace(/<img\b([^>]*)>/giu, (_match, attrs: string) => {
    const alt = attrValue(attrs, 'alt') || attrValue(attrs, 'title') || attrValue(attrs, 'name')
    return alt ? ` ${alt} ` : ' [image] '
  })
}

function replaceAnchors(input: string): string {
  return input.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu, (_match, attrs: string, body: string) => {
    const label: string = htmlToPlainText(body)
    const href = attrValue(attrs, 'href')
    return label || href
  })
}

function normalizeTextSpacing(input: string) {
  return input
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripTagsToText(input: string) {
  return normalizeTextSpacing(
    decodeHtmlEntities(input)
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/<\/(?:p|div|section|article|header|footer|main|aside|tr|h[1-6])>/giu, '\n')
      .replace(HTML_TAG_GLOBAL_RE, ' '),
  )
}

function htmlToPlainText(input: string): string {
  const withoutMedia: string = replaceAnchors(replaceImages(input))
  const withListBreaks: string = withoutMedia
    .replace(/<li\b[^>]*>/giu, '\n- ')
    .replace(/<\/li>/giu, '')
  return stripTagsToText(withListBreaks)
    .replace(/\n-\s*/g, '; ')
    .replace(/\s*;\s*$/, '')
    .replace(/\n+/g, '; ')
}

function escapeTableCell(input: string) {
  return input
    .replace(/\|/g, '\\|')
    .replace(/\s*[\r\n]+\s*/g, '; ')
    .trim()
}

function convertTables(input: string) {
  return input.replace(TABLE_RE, (table) => {
    const rows = Array.from(table.matchAll(ROW_RE))
      .map((rowMatch) => Array.from(rowMatch[1].matchAll(CELL_RE)).map((cellMatch) => htmlToPlainText(cellMatch[2])))
      .filter((row) => row.length > 0)

    if (!rows.length) return htmlToPlainText(table)

    const columnCount = Math.max(...rows.map((row) => row.length))
    const normalizedRows = rows.map((row) => Array.from(
      { length: columnCount },
      (_item, index) => escapeTableCell(row[index] ?? ''),
    ))
    const [head, ...body] = normalizedRows
    const separator = Array.from({ length: columnCount }, () => '---')
    const markdownRows = [head, separator, ...body].map((row) => `| ${row.join(' | ')} |`)

    return `\n${markdownRows.join('\n')}\n`
  })
}

function convertLists(input: string) {
  let output = input
  for (let pass = 0; pass < 4; pass += 1) {
    const next = output.replace(LIST_RE, (_match, kind: string, body: string) => {
      const items = Array.from(body.matchAll(LIST_ITEM_RE)).map((itemMatch) => htmlToPlainText(itemMatch[1]))
      if (!items.length) return htmlToPlainText(body)
      return `\n${items.map((item, index) => `${kind.toLowerCase() === 'ol' ? `${index + 1}.` : '-'} ${item}`).join('\n')}\n`
    })
    if (next === output) break
    output = next
  }
  return output
}

function convertHeadings(input: string) {
  return input.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_match, level: string, body: string) => {
    const marker = '#'.repeat(Math.min(Number(level), 4))
    return `\n${marker} ${htmlToPlainText(body)}\n`
  })
}

function convertRemainingBlocks(input: string) {
  return input
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|main|aside|tbody|thead|tr)>/giu, '\n')
    .replace(/<(?:p|div|section|article|header|footer|main|aside|tbody|thead|tr)\b[^>]*>/giu, '\n')
    .replace(/<\/?(?:colgroup|col|span|strong|b|em|i)\b[^>]*>/giu, ' ')
}

export function normalizeReadableMarkup(input: string) {
  const decoded = decodeHtmlEntities(input)
  if (!hasHtmlTags(decoded)) return normalizeTextSpacing(decoded)

  const converted = convertRemainingBlocks(convertHeadings(convertLists(convertTables(replaceAnchors(replaceImages(decoded))))))
  return normalizeTextSpacing(converted.replace(HTML_TAG_GLOBAL_RE, ' '))
}
