import type { PrdNode, PrdNodeAudience, PrdNodeSectionKey, PrdNodeSections, PrdNodeSpecLens } from '../types/prdNode'

const LEGACY_LENS_AUDIENCES = new Set<PrdNodeAudience>(['model', 'ctrl', 'view'])

export function specLensFromLegacyAudience(audience: PrdNodeAudience | null | undefined): PrdNodeSpecLens | null {
  if (audience === 'model') return 'model'
  if (audience === 'ctrl') return 'control'
  if (audience === 'view') return 'view'
  return null
}

export function normalizeSpecLensValue(value: unknown): PrdNodeSpecLens | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (!text) return null
  if (['full', 'page', 'pagespec', 'page-spec', 'spec'].includes(text)) return 'full'
  if (['model', 'data', 'domain', 'config', 'state', 'rule', 'rules'].includes(text)) return 'model'
  if (['ctrl', 'controller', 'control', 'interaction', 'flow', 'logic'].includes(text)) return 'control'
  if (['view', 'ui', 'screen', 'visual', 'presentation'].includes(text)) return 'view'
  return null
}

export function normalizeSectionKeyForLens(lens: PrdNodeSpecLens | null | undefined): PrdNodeSectionKey | null {
  if (lens === 'model') return 'data'
  if (lens === 'control') return 'interaction'
  if (lens === 'view') return 'view'
  return null
}

export function normalizeLegacyAudience(audience: PrdNodeAudience | null | undefined): PrdNodeAudience | null {
  if (!audience) return null
  return LEGACY_LENS_AUDIENCES.has(audience) ? null : audience
}

export function defaultAudienceForSpecLens(lens: PrdNodeSpecLens | null | undefined): PrdNodeAudience | null {
  if (lens === 'model') return 'config'
  if (lens === 'control' || lens === 'view') return 'client'
  return null
}

export function resolveNodeSpecLens(node: Pick<PrdNode, 'specLens' | 'audience' | 'type'>): PrdNodeSpecLens {
  return node.specLens ?? specLensFromLegacyAudience(node.audience) ?? (node.type === 'page' ? 'full' : 'full')
}

export function resolveNodeAudience(node: Pick<PrdNode, 'audience' | 'specLens' | 'type'>): PrdNodeAudience | null {
  const normalized = normalizeLegacyAudience(node.audience)
  if (normalized) return normalized
  return defaultAudienceForSpecLens(resolveNodeSpecLens(node)) ?? (node.type === 'page' || node.type === 'ui' ? 'client' : null)
}

export function formatSpecLens(lens: PrdNodeSpecLens | null | undefined) {
  if (lens === 'model') return 'Data / Model'
  if (lens === 'control') return 'Interaction / Control'
  if (lens === 'view') return 'View'
  return 'Page Spec'
}

export function formatSectionTitle(key: PrdNodeSectionKey) {
  if (key === 'data') return 'Data / Model'
  if (key === 'interaction') return 'Interaction / Control'
  return 'View'
}

export function hasNodeSections(sections: PrdNodeSections | null | undefined) {
  return Boolean(sections && Object.values(sections).some((section) => section?.summary || section?.content))
}

export function normalizeNodeLensFields<T extends Pick<PrdNode, 'audience' | 'type'> & Partial<Pick<PrdNode, 'specLens'>>>(
  node: T,
): T & { audience?: PrdNodeAudience | null; specLens?: PrdNodeSpecLens | null } {
  const specLens = node.specLens ?? specLensFromLegacyAudience(node.audience) ?? (node.type === 'page' ? 'full' : null)
  const audience = normalizeLegacyAudience(node.audience) ?? defaultAudienceForSpecLens(specLens) ?? (node.type === 'page' || node.type === 'ui' ? 'client' : null)
  return { ...node, audience, specLens }
}
