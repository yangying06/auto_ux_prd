/**
 * Shared text/list normalization primitives used across all normalize modules.
 *
 * Extracted from src/store/appStore.ts. No dependencies on store state.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function normalizeTextList(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, limit)
}

export function normalizeStringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function normalizeStringArray(value: string[] | undefined) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function normalizeWorkflowStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function normalizeConfidencePercent(value: unknown, fallback = 70) {
  const parsed = Number.parseInt(value as string, 10)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback
}
