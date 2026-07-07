/**
 * Prototype prompt + spec builders.
 *
 * Extracted from server/index.ts. Turns a UXRequirementState into the prompt
 * sections used to drive HTML prototype generation (create / update), plus
 * Figma asset-usage and screenshot-fidelity policy blocks.
 */
import { formatPerformanceSpecForPrompt } from '../../src/lib/performanceOrchestration'
import { formatPrototypeSpecForPrompt } from '../../src/lib/prototypeSpec'
import type { UXRequirementState } from '../../src/types/uxRequirement'

export interface FigmaAssetReference {
  url: string
  label: string
  type: string
}


export function buildPrototypeSpec(requirementState: UXRequirementState) {
  const hasComponents = requirementState.ui_components.length > 0
  const componentTree = hasComponents
    ? JSON.stringify(requirementState.ui_components, null, 2)
    : '（暂无组件信息，请根据 trigger_condition 和 sequence_rules 推断界面结构）'
  const assetDependencies = requirementState.asset_dependencies.length > 0
    ? JSON.stringify(requirementState.asset_dependencies, null, 2)
    : '（暂无可用资源）'
  const prototypeSpecSection = requirementState.prototype_spec
    ? `${formatPrototypeSpecForPrompt(requirementState.prototype_spec)}

## 生成关系
- Prototype Spec 是本轮生成的源事实和交付语义。
- HTML 只能作为预览/验证渲染：用于检查状态、布局、交互和素材引用是否符合 Spec。
- 当旧需求状态与 Prototype Spec 不一致时，以 Prototype Spec 为准；旧需求状态只作为补充背景。`
    : `## Prototype Spec（未生成）
本轮没有显式 Prototype Spec，请从需求状态临时推导预览，但不要把 HTML 当作交付源文件。`

  return `${prototypeSpecSection}

## 旧需求状态（补充背景）
触发条件：${requirementState.trigger_condition ?? '未知'}
执行规则：${requirementState.sequence_rules ?? '未知'}
引擎约束：${requirementState.engine_constraints ?? '无'}
完成度：${requirementState.completion_rate}%

## 可用资源
${assetDependencies}

## 表现编排
${requirementState.performance_spec ? formatPerformanceSpecForPrompt(requirementState.performance_spec) : '未提供单独的表现编排规格；请仅根据执行规则模拟关键状态反馈。'}

## 组件树
${componentTree}`
}

export function buildScreenshotFidelitySection() {
  return `## 参考图还原纪律
1. 本次附带了参考图。请严格按照参考图还原界面：布局结构、视觉层级、配色、文案文字、控件位置与间距都要尽量贴合。
2. 文案以参考图中的真实文字为准；参考图中能看清的文字优先照抄，不要凭空臆造或改写。
3. 当参考图与下方需求状态文字描述冲突时，以参考图的视觉呈现为准；需求状态 JSON 仅用于补充交互逻辑、状态流转与引擎约束等图上看不到的信息。
4. 忽略参考图中的采集/评审伪影：例如对比外壳、手机边框/刘海、浏览器窗口、标尺、批注箭头、红框、水印等，这些不属于要还原的界面本身。
`
}

export function buildFigmaEvidencePolicySection(hasImages: boolean) {
  if (!hasImages) return ''
  return `
## Figma / 参考图优先级
- 如果附件来自 Figma Frame、布局参考图或界面截图，它是视觉结构的主来源：布局、层级、间距、颜色、控件位置、文字和素材位置都优先按图还原。
- PRD 和节点文档只用于补充交互逻辑、状态流转、数据条件、目标平台制作约束和图中不可见的异常状态。
- 如果 Figma 证据列出“数值占位”，说明原图中的示例数字已从位图中去除；生成 HTML 时必须在对应坐标叠加真实业务数值或动态占位，不要还原 Figma 示例数字。
- 不要自行发明参考图/Figma 中不存在的装饰图、角色图、背景图或外层设备框。`
}

export function extractFigmaAssetReferences(requirementState: UXRequirementState): FigmaAssetReference[] {
  const seen = new Set<string>()
  return requirementState.asset_dependencies
    .map((asset): FigmaAssetReference | null => {
      const rawPath = asset.path ?? ''
      const url = rawPath.split('|')[0]?.trim()
      if (!url || !/^https?:\/\/[^\s]+$/u.test(url)) return null
      if (!asset.type.toLowerCase().includes('figma') && !url.includes('/api/figma/assets/')) return null
      if (seen.has(url)) return null
      seen.add(url)
      return {
        url,
        label: rawPath.split('|').slice(1).join('|').trim() || asset.type,
        type: asset.type,
      }
    })
    .filter((asset): asset is FigmaAssetReference => Boolean(asset))
    .slice(0, 6)
}

export function buildFigmaAssetUsageSection(requirementState: UXRequirementState) {
  const assets = extractFigmaAssetReferences(requirementState)
  if (!assets.length) return ''

  return `
## Figma 位图资产使用契约
本次 Figma 子图已经作为可访问图片资源缓存到本地代理。生成 HTML 时必须真实引用这些图片，而不是只按视觉重新绘制。

可用 Figma 图片：
${assets.map((asset, index) => `${index + 1}. ${asset.type}｜${asset.label}\n   URL: ${asset.url}`).join('\n')}

使用要求：
- 至少使用 1 张 Figma 图片作为主视觉图层；如果存在 FigmaFrameImage，优先把它作为底图或首屏主图。
- 对重要子区域，用 FigmaSubImage 作为真实 \`<img src="...">\` 或 \`background-image:url(...)\` 图层，再叠加 HTML 状态、按钮、热点、弹层和流程反馈。
- 不要用纯 CSS/渐变/假卡片替代这些 Figma 图片；CSS 只负责适配、遮罩、交互状态和补充图中不可见的 PRD 逻辑。
- 这些 URL 来自当前本地代理 \`/api/figma/assets/\`，允许在预览 HTML 中直接引用。`
}
