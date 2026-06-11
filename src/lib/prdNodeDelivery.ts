import {
  formatSectionTitle,
  hasNodeSections,
  normalizeSectionKeyForLens,
  resolveNodeAudience,
  resolveNodeSpecLens,
} from './prdNodeLens'
import type {
  PrdNode,
  PrdNodeBackendContractKind,
  PrdNodeBackendContractRef,
  PrdNodeEvidenceRef,
  PrdNodeSectionKey,
  PrdTree,
} from '../types/prdNode'

export const DELIVERY_SECTION_ORDER: PrdNodeSectionKey[] = ['view', 'interaction', 'data']

export type DeliverySectionStatus = 'ready' | 'needs_review' | 'missing'

export interface DeliverySectionSummary {
  key: PrdNodeSectionKey
  label: string
  title: string
  summary: string | null
  content: string | null
  evidenceRefs: PrdNodeEvidenceRef[]
  openQuestions: string[]
  sourceNodeIds: string[]
  status: DeliverySectionStatus
}

function textOrNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function evidenceKey(ref: PrdNodeEvidenceRef) {
  return `${ref.sourceKind}:${ref.sourceLabel}:${ref.quote ?? ''}`
}

function contractKey(contract: PrdNodeBackendContractRef) {
  return contract.id ?? contract.targetNodeId ?? `${contract.kind}:${contract.title}`
}

function childrenOf(node: PrdNode, tree: PrdTree | null | undefined) {
  return node.children
    .map((childId) => tree?.[childId])
    .filter((child): child is PrdNode => Boolean(child))
}

export function deliverySectionLabel(key: PrdNodeSectionKey) {
  if (key === 'view') return '画面'
  if (key === 'interaction') return '操作'
  return '数据'
}

export function deliverySectionStatusLabel(status: DeliverySectionStatus) {
  if (status === 'ready') return '已整理'
  if (status === 'needs_review') return '待确认'
  return '缺失'
}

export function isLensChildNode(node: PrdNode, tree: PrdTree | null | undefined) {
  if (!node.parentId || !tree?.[node.parentId]) return false
  const parent = tree[node.parentId]
  if (parent.type !== 'page') return false
  return normalizeSectionKeyForLens(resolveNodeSpecLens(node)) !== null
}

export function isDeliveryNode(node: PrdNode, tree: PrdTree | null | undefined) {
  if (node.parentId === null || node.type === 'module') return false
  if (isLensChildNode(node, tree)) return false
  return node.type === 'page' || node.type === 'ui'
}

export function collectDeliveryNodes(tree: PrdTree) {
  const nodes = Object.values(tree).filter((node) => isDeliveryNode(node, tree))
  return nodes.sort((a, b) => a.level - b.level || a.order - b.order || a.id.localeCompare(b.id))
}

export function buildDeliveryDisplayTree(tree: PrdTree) {
  const visibleEntries = Object.entries(tree).filter(([, node]) => !isLensChildNode(node, tree))
  const next = Object.fromEntries(
    visibleEntries.map(([id, node]) => [id, { ...node, children: [] }]),
  ) as PrdTree

  for (const node of Object.values(next)) {
    if (node.parentId && next[node.parentId]) {
      next[node.parentId].children.push(node.id)
    }
  }

  for (const node of Object.values(next)) {
    node.children.sort((a, b) => (next[a]?.order ?? 0) - (next[b]?.order ?? 0))
  }

  return next
}

export function getFoldedLensChildren(pageNode: PrdNode, tree: PrdTree | null | undefined) {
  return childrenOf(pageNode, tree).filter((child) => isLensChildNode(child, tree))
}

function contractKindForNode(node: PrdNode): PrdNodeBackendContractKind | null {
  const audience = resolveNodeAudience(node)
  if (audience === 'api') return 'api'
  if (audience === 'config') return 'config'
  if (audience === 'server') return 'server'
  if (resolveNodeSpecLens(node) === 'model') return 'data'
  return null
}

export function collectBackendContracts(node: PrdNode, tree: PrdTree | null | undefined) {
  const explicit = node.backendContracts ?? []
  const referenced = (node.references ?? [])
    .map((reference): PrdNodeBackendContractRef | null => {
      const target = reference.targetNodeId ? tree?.[reference.targetNodeId] : null
      const kind = target ? contractKindForNode(target) : null
      if (!target || !kind) return null
      return {
        id: reference.label || target.id,
        title: reference.label || target.label,
        kind,
        summary: reference.reason ?? target.summary,
        targetNodeId: target.id,
        evidenceRefs: target.evidenceRefs ?? [],
      }
    })
    .filter((contract): contract is PrdNodeBackendContractRef => Boolean(contract))

  return uniqueBy([...explicit, ...referenced], contractKey)
}

export function collectDeliveryEvidence(node: PrdNode, tree: PrdTree | null | undefined) {
  const sections = buildDeliverySections(node, tree)
  const sectionEvidence = sections.flatMap((section) => section.evidenceRefs)
  const childEvidence = getFoldedLensChildren(node, tree).flatMap((child) => child.evidenceRefs ?? [])
  const contractEvidence = collectBackendContracts(node, tree).flatMap((contract) => contract.evidenceRefs ?? [])
  return uniqueBy([...(node.evidenceRefs ?? []), ...sectionEvidence, ...childEvidence, ...contractEvidence], evidenceKey)
}

export function buildDeliverySections(node: PrdNode, tree: PrdTree | null | undefined): DeliverySectionSummary[] {
  const foldedChildren = getFoldedLensChildren(node, tree)

  return DELIVERY_SECTION_ORDER.map((key) => {
    const section = node.sections?.[key]
    const sourceChildren = foldedChildren.filter((child) => normalizeSectionKeyForLens(resolveNodeSpecLens(child)) === key)
    const childContent = sourceChildren.map((child) => textOrNull(child.content)).filter((item): item is string => Boolean(item))
    const childEvidence = sourceChildren.flatMap((child) => child.evidenceRefs ?? [])
    const contentParts = [textOrNull(section?.content), ...childContent].filter((item): item is string => Boolean(item))
    const content = uniqueBy(contentParts, (item) => item).join('\n\n').trim() || null
    const openQuestions = uniqueBy([...(section?.openQuestions ?? [])].filter(Boolean), (item) => item)
    const hasContent = Boolean(textOrNull(section?.summary) || content || (section?.evidenceRefs?.length ?? 0) > 0 || childEvidence.length)
    const childNeedsReview = sourceChildren.some((child) => child.status !== 'done' && child.needsPolish)
    const status: DeliverySectionStatus = hasContent
      ? (openQuestions.length > 0 || childNeedsReview ? 'needs_review' : 'ready')
      : 'missing'

    return {
      key,
      label: deliverySectionLabel(key),
      title: section?.title ?? formatSectionTitle(key),
      summary: textOrNull(section?.summary) ?? sourceChildren.map((child) => textOrNull(child.summary)).find(Boolean) ?? null,
      content,
      evidenceRefs: uniqueBy([...(section?.evidenceRefs ?? []), ...childEvidence], evidenceKey),
      openQuestions,
      sourceNodeIds: sourceChildren.map((child) => child.id),
      status,
    }
  })
}

export function hasDeliverySections(node: PrdNode, tree: PrdTree | null | undefined) {
  return hasNodeSections(node.sections) || getFoldedLensChildren(node, tree).length > 0
}

