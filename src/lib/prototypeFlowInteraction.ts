export interface PrototypeFlowJumpEdge {
  id?: string | null
  targetNodeId: string
  label?: string | null
  reason?: string | null
  targetLabel?: string | null
}

const PUNCTUATION_PATTERN = /[\s"'`.,;:!?()[\]{}<>/\\|+\-=*_~#$%^&，。？！、；：“”‘’（）【】《》]+/gu
const QUOTED_TERM_PATTERN = /["'\u201c\u201d\u2018\u2019]([^"'\u201c\u201d\u2018\u2019]{1,32})["'\u201c\u201d\u2018\u2019]/gu
const TRIGGER_TERM_PATTERN = /(?:\u70b9\u51fb|\u70b9\u6309|\u6309\u4e0b|\u9009\u62e9|\u6253\u5f00|\u8fdb\u5165|\u63d0\u4ea4|\u786e\u8ba4|\u8df3\u8f6c|\u524d\u5f80|click|tap|press|select|open|submit|confirm)\s*["'\u201c\u201d\u2018\u2019]?([^，。；、,.!?！？;:\n\r"'\u201c\u201d\u2018\u2019]{1,32}?)(?:\s*(?:\u6309\u94ae|\u5165\u53e3|\u9009\u9879|\u6807\u7b7e|tab|button|btn|\u540e|\u65f6|\u5e76|\u7136\u540e|\u8fdb\u5165|\u6253\u5f00|\u8df3\u8f6c|\u524d\u5f80|to|$))/giu
const SPLIT_TERM_PATTERN = /[>\-–—|/，。；、,.;:：\n\r]+/u
const GENERIC_WORDS = [
  '\u70b9\u51fb',
  '\u70b9\u6309',
  '\u6309\u4e0b',
  '\u9009\u62e9',
  '\u6253\u5f00',
  '\u8fdb\u5165',
  '\u63d0\u4ea4',
  '\u786e\u8ba4',
  '\u8df3\u8f6c',
  '\u524d\u5f80',
  '\u6309\u94ae',
  '\u5165\u53e3',
  '\u9009\u9879',
  '\u6807\u7b7e',
  '\u9875\u9762',
  '\u754c\u9762',
  '\u89e6\u53d1',
  '\u7136\u540e',
  '\u540e',
  '\u65f6',
  'click',
  'tap',
  'press',
  'select',
  'open',
  'submit',
  'confirm',
  'button',
  'btn',
  'page',
  'screen',
  'view',
  'jump',
  'go',
  'to',
  'then',
]

export function normalizePrototypeInteractionText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(PUNCTUATION_PATTERN, '')
    .trim()
}

function stripGenericWords(value: string) {
  let result = value.trim()
  let changed = true
  let attempts = 0

  while (changed && attempts < 4) {
    changed = false
    attempts += 1

    for (const word of GENERIC_WORDS) {
      const lower = result.toLocaleLowerCase()
      const wordLower = word.toLocaleLowerCase()
      if (lower.startsWith(wordLower) && result.length > word.length) {
        result = result.slice(word.length).trim()
        changed = true
      }
      if (lower.endsWith(wordLower) && result.length > word.length) {
        result = result.slice(0, -word.length).trim()
        changed = true
      }
    }
  }

  return result
}

function addTerm(terms: string[], value: string | null | undefined) {
  const stripped = stripGenericWords((value ?? '').replace(/\s+/gu, ' ').trim())
  const normalized = normalizePrototypeInteractionText(stripped)
  if (normalized.length < 2) return
  if (GENERIC_WORDS.some((word) => normalizePrototypeInteractionText(word) === normalized)) return
  if (!terms.some((term) => normalizePrototypeInteractionText(term) === normalized)) {
    terms.push(stripped)
  }
}

function collectEdgeTerms(edge: PrototypeFlowJumpEdge) {
  const terms: string[] = []
  const fields = [edge.label, edge.reason]

  for (const field of fields) {
    if (!field) continue
    addTerm(terms, field)

    for (const match of field.matchAll(QUOTED_TERM_PATTERN)) {
      addTerm(terms, match[1])
    }

    for (const match of field.matchAll(TRIGGER_TERM_PATTERN)) {
      addTerm(terms, match[1])
    }

    for (const part of field.split(SPLIT_TERM_PATTERN)) {
      if (part.length <= 32) addTerm(terms, part)
    }
  }

  return terms
}

export function scorePrototypeFlowEdgeClick(edge: PrototypeFlowJumpEdge, clickText: string | null | undefined) {
  const clickNormalized = normalizePrototypeInteractionText(clickText)
  if (clickNormalized.length < 2) return 0

  let bestScore = 0
  for (const term of collectEdgeTerms(edge)) {
    const termNormalized = normalizePrototypeInteractionText(term)
    if (termNormalized.length < 2) continue
    if (termNormalized === clickNormalized) {
      bestScore = Math.max(bestScore, 100 + termNormalized.length)
    } else if (clickNormalized.includes(termNormalized)) {
      bestScore = Math.max(bestScore, 80 + termNormalized.length)
    } else if (termNormalized.includes(clickNormalized)) {
      bestScore = Math.max(bestScore, 60 + clickNormalized.length)
    }
  }

  return bestScore
}

export function prototypeFlowEdgeMatchesClick(edge: PrototypeFlowJumpEdge, clickText: string | null | undefined) {
  return scorePrototypeFlowEdgeClick(edge, clickText) > 0
}

export function pickPrototypeFlowJumpEdge(edges: PrototypeFlowJumpEdge[], clickText: string | null | undefined) {
  let best: { edge: PrototypeFlowJumpEdge; score: number } | null = null

  for (const edge of edges) {
    const score = scorePrototypeFlowEdgeClick(edge, clickText)
    if (score <= 0) continue
    if (!best || score > best.score) best = { edge, score }
  }

  return best?.edge ?? null
}
