/**
 * Shared error-handling helpers for the frontend.
 *
 * Centralises the two tiny helpers that were duplicated verbatim across
 * ForgePage.tsx and ForgeChat.tsx, so their fallback strings and the
 * AbortError detection stay consistent.
 */

/** Return `error.message` when present, otherwise `fallback`. */
export function errorMessageFromUnknown(error: unknown, fallback = '操作失败，请重试。'): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** True when `error` is an AbortError (e.g. a fetch cancelled via AbortController). */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && String((error as { name?: unknown }).name) === 'AbortError'
}
