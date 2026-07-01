export interface FigmaPrdAlignmentFrame {
  id?: string
  name: string
  visibleTexts?: string[]
  annotations?: string[]
  interactionTips?: string[]
  childNames?: string[]
}

export interface FigmaPrdAlignmentGroup {
  key: string
  label: string
  frames: FigmaPrdAlignmentFrame[]
}

export interface FigmaPrdAlignmentSection {
  id: string
  label: string
  matchText: string
  text: string
  headingBacked?: boolean
}

export interface FigmaPrdAlignmentMatch {
  groupKey: string
  sectionId: string
  sourceLabel: string
  score: number
  confidence: number
  matchedTerms: string[]
  reason: string
  excerpt: string
  content: string
}

export interface FigmaPrdAlignmentResult {
  matchesByGroup: Map<string, FigmaPrdAlignmentMatch[]>
  unmatchedSections: FigmaPrdAlignmentSection[]
}

interface WeightedTerm {
  term: string
  normalized: string
  weight: number
}

const GENERIC_TERMS = new Set([
  'ai',
  'ui',
  '页面',
  '界面',
  '弹窗',
  '浮层',
  '面板',
  '按钮',
  '入口',
  '状态',
  '默认',
  '内容',
  '列表',
  '详情',
  '信息',
  '用户',
  '系统',
  '流程',
  '规则',
  '功能',
  '模块',
  '点击',
  '选择',
  '确认',
  '取消',
  '返回',
  '关闭',
  '打开',
  '进入',
  '展示',
  '显示',
  '生成',
  '提交',
  '成功',
  '失败',
  'loading',
])

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function compactAlignmentText(value: string | null | undefined, maxLength = 220) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

export function normalizeAlignmentText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/页面/g, '界面')
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fa5]+/gu, '')
    .toLocaleLowerCase()
}

function isMeaningfulTerm(term: string) {
  const normalized = normalizeAlignmentText(term)
  if (normalized.length < 2 || normalized.length > 36) return false
  if (GENERIC_TERMS.has(normalized)) return false
  if (/^\d+$/u.test(normalized)) return false
  if (/^(frame|group|section|container|copy|image|icon|vector)\d*$/iu.test(normalized)) return false
  return true
}

function pushTerm(terms: Map<string, WeightedTerm>, rawTerm: string, weight: number) {
  const normalized = normalizeAlignmentText(rawTerm)
  if (!isMeaningfulTerm(normalized)) return
  const existing = terms.get(normalized)
  if (!existing || weight > existing.weight) {
    terms.set(normalized, {
      term: compactAlignmentText(rawTerm, 40),
      normalized,
      weight,
    })
  }
}

function addHanNgrams(terms: Map<string, WeightedTerm>, raw: string, weight: number) {
  const normalized = normalizeAlignmentText(raw)
  if (normalized.length < 4 || normalized.length > 30) return
  for (let start = 0; start < normalized.length - 1; start += 1) {
    for (let size = 2; size <= 4 && start + size <= normalized.length; size += 1) {
      pushTerm(terms, normalized.slice(start, start + size), weight)
    }
  }
}

function termsFromValues(values: Array<string | null | undefined>, baseWeight: number) {
  const terms = new Map<string, WeightedTerm>()
  for (const value of values) {
    const text = compactAlignmentText(value, 180)
    if (!text) continue
    pushTerm(terms, text, baseWeight)
    for (const segment of text.split(/[\s,.;:|\/\\()[\]{}<>，。；：、（）【】《》'"“”‘’!?！？_-]+/u)) {
      pushTerm(terms, segment, Math.max(1, baseWeight - 1))
      addHanNgrams(terms, segment, Math.max(1, baseWeight - 4))
    }
  }
  return terms
}

export function extractFigmaPrdGroupTerms(group: FigmaPrdAlignmentGroup) {
  const titleTerms = termsFromValues(
    [
      group.label,
      ...group.frames.map((frame) => frame.name),
    ],
    12,
  )
  const contentTerms = termsFromValues(
    group.frames.flatMap((frame) => [
      ...(frame.visibleTexts ?? []),
      ...(frame.childNames ?? []),
      ...(frame.annotations ?? []),
      ...(frame.interactionTips ?? []),
    ]),
    9,
  )

  for (const term of contentTerms.values()) {
    const current = titleTerms.get(term.normalized)
    if (!current || term.weight > current.weight) titleTerms.set(term.normalized, term)
  }

  return [...titleTerms.values()].sort((a, b) => b.weight - a.weight || b.normalized.length - a.normalized.length)
}

function scoreTermInSection(term: WeightedTerm, titleText: string, bodyText: string) {
  const titleHit = titleText.includes(term.normalized)
  const bodyHit = bodyText.includes(term.normalized)
  if (!titleHit && !bodyHit) return 0

  const lengthBonus = Math.min(12, term.normalized.length)
  let score = 0
  if (titleHit) score += term.weight * 4 + lengthBonus
  if (bodyHit) score += term.weight * 1.8 + Math.ceil(lengthBonus / 2)
  return score
}

function scoreGroupAgainstSection(group: FigmaPrdAlignmentGroup, section: FigmaPrdAlignmentSection) {
  const titleText = normalizeAlignmentText(section.matchText)
  const bodyText = normalizeAlignmentText(section.text.slice(0, 4000))
  const scoredTerms = extractFigmaPrdGroupTerms(group)
    .map((term) => ({ term, score: scoreTermInSection(term, titleText, bodyText) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.term.normalized.length - a.term.normalized.length)

  const matchedTerms = scoredTerms.map((item) => item.term.term)
  const score = Math.round(scoredTerms.reduce((sum, item) => sum + item.score, 0))
  return { score, matchedTerms }
}

function matchReason(matchedTerms: string[], score: number) {
  const terms = matchedTerms.slice(0, 6).join(' / ')
  return terms
    ? `PRD/Figma 对齐：命中 ${terms}，综合分 ${score}`
    : `PRD/Figma 对齐：综合分 ${score}`
}

export function buildFigmaPrdAlignment(
  groups: FigmaPrdAlignmentGroup[],
  sections: FigmaPrdAlignmentSection[],
  options: { maxMatchesPerGroup?: number; minScore?: number } = {},
): FigmaPrdAlignmentResult {
  const maxMatchesPerGroup = options.maxMatchesPerGroup ?? 3
  const minScore = options.minScore ?? 34
  const matchesByGroup = new Map<string, FigmaPrdAlignmentMatch[]>()
  const usedSectionIds = new Set<string>()

  for (const group of groups) {
    const matches = sections
      .map((section) => {
        const { score, matchedTerms } = scoreGroupAgainstSection(group, section)
        if (score < minScore || matchedTerms.length === 0) return null
        const hasSpecificTerm = matchedTerms.some((term) => normalizeAlignmentText(term).length >= 4)
        if (matchedTerms.length < 2 && !hasSpecificTerm) return null
        return {
          groupKey: group.key,
          sectionId: section.id,
          sourceLabel: section.label,
          score,
          confidence: clamp(Math.round(48 + score * 0.85), 58, 94),
          matchedTerms: matchedTerms.slice(0, 10),
          reason: matchReason(matchedTerms, score),
          excerpt: compactAlignmentText(section.text, 260),
          content: section.text.trim(),
        } satisfies FigmaPrdAlignmentMatch
      })
      .filter((match): match is FigmaPrdAlignmentMatch => Boolean(match))
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
      .slice(0, maxMatchesPerGroup)

    if (matches.length > 0) {
      matches.forEach((match) => usedSectionIds.add(match.sectionId))
      matchesByGroup.set(group.key, matches)
    }
  }

  return {
    matchesByGroup,
    unmatchedSections: sections.filter((section) => !usedSectionIds.has(section.id)),
  }
}
