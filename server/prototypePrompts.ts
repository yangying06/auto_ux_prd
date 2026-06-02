// Multi-variant prototype generation configs.
//
// We only use a single provider (Claude), so cross-variant diversity comes from two
// levers: a distinct "design focus" instruction injected into each variant's prompt,
// and a distinct sampling temperature. Kept as a pure module so the fan-out logic can
// be unit tested without booting the Express server.

export const VARIANT_FOCUS: string[] = [
  '严格还原参考图的布局与视觉层级，优先保证结构与原图一致。',
  '在还原基础上优化信息密度与可读性，适当收敛留白与字号层级。',
  '强调视觉冲击与品质感：合理使用阴影、渐变、圆角和微交互反馈。',
  '移动端紧凑布局优先，按 375px 安全区组织信息，触控目标不小于 44px。',
]

export const VARIANT_TEMPERATURES: number[] = [0.4, 0.7, 0.9, 1.0]

export const DEFAULT_CREATE_VARIANTS = 4
export const DEFAULT_UPDATE_VARIANTS = 2
export const MAX_VARIANTS = 4

export interface VariantConfig {
  index: number
  focus: string
  temperature: number
}

export function clampVariantCount(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(MAX_VARIANTS, Math.max(1, n))
}

export function buildVariantConfigs(numVariants: number, offset = 0): VariantConfig[] {
  const count = clampVariantCount(numVariants, DEFAULT_CREATE_VARIANTS)
  return Array.from({ length: count }, (_, position) => {
    const sourceIndex = position + offset
    return {
      index: position,
      focus: VARIANT_FOCUS[sourceIndex % VARIANT_FOCUS.length],
      temperature: VARIANT_TEMPERATURES[sourceIndex % VARIANT_TEMPERATURES.length],
    }
  })
}
