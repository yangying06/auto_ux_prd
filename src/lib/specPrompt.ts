import type { PrdTree } from '../types/prdNode'
import type { UXRequirementState } from '../types/uxRequirement'

function formatValue(value: string | null | undefined, fallback = '未明确') {
  return value?.trim() || fallback
}

function formatAssets(requirement: UXRequirementState) {
  if (!requirement.asset_dependencies.length) return '- 未明确资源依赖'
  return requirement.asset_dependencies
    .map((asset) => `- ${asset.type}: ${asset.path ?? '路径待定'}${asset.is_ready ? ' (ready)' : ' (missing)'}`)
    .join('\n')
}

function formatComponentTree(components: UXRequirementState['ui_components'], depth = 0): string {
  if (!components.length && depth === 0) return '- 未提供组件树，请根据交互规则推断'
  return components.map((component) => {
    const indent = '  '.repeat(depth)
    const states = component.states.length ? component.states.join(', ') : 'idle'
    const line = `${indent}- ${component.name} (${component.type}, states: ${states}, z:${component.z_order})${component.notes ? ` - ${component.notes}` : ''}`
    const children = component.children.length ? `\n${formatComponentTree(component.children, depth + 1)}` : ''
    return `${line}${children}`
  }).join('\n')
}

export function requirementToBoltPrompt(requirement: UXRequirementState) {
  return `请基于以下 GameUX 交互规格生成一个可运行的单文件 HTML/CSS/JS 原型。

要求：
- 输出可直接运行的前端原型，不需要构建步骤。
- 使用内联 CSS/JS 或 CDN，界面应有游戏 UX 质感。
- 覆盖主要状态、按钮反馈、加载/禁用/错误态和关键动画。
- 保留清晰的组件标注，便于设计师和开发复核。
- 所有用户可见界面文字、按钮文案、状态提示、组件标注和说明文字必须是中文；只有代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。

交互规格：
触发条件：${formatValue(requirement.trigger_condition)}
执行规则：${formatValue(requirement.sequence_rules)}
引擎约束：${formatValue(requirement.engine_constraints, '无特殊 Cocos 约束')}
完成度：${requirement.completion_rate}%

资源依赖：
${formatAssets(requirement)}

UI 组件树：
${formatComponentTree(requirement.ui_components)}
`
}

function buildNodePath(id: string, tree: PrdTree) {
  const labels: string[] = []
  let current: PrdTree[string] | undefined = tree[id]
  while (current) {
    labels.unshift(current.label)
    current = current.parentId ? tree[current.parentId] : undefined
  }
  return labels.join(' / ')
}

export function prdTreeToBoltPrompt(tree: PrdTree) {
  const nodes = Object.values(tree)
  const leaves = nodes.filter((node) => node.children.length === 0)
  const completedLeaves = leaves.filter((node) => node.status === 'done')
  const visualLeaves = leaves.filter((node) => node.type === 'ui' || node.audience === 'client')
  const completedVisualLeaves = visualLeaves.filter((node) => node.status === 'done')
  const sourceNodes = completedVisualLeaves.length
    ? completedVisualLeaves
    : completedLeaves.length
      ? completedLeaves
      : visualLeaves.length
        ? visualLeaves
        : leaves

  const specs = sourceNodes.map((node) => [
    `## ${buildNodePath(node.id, tree)}`,
    `- 文档节点编号：${node.id}`,
    node.docPath ? `- 导出路径：${node.docPath}` : null,
    node.audience ? `- 面向角色：${node.audience}` : null,
    `- 类型：${node.type}`,
    `- 状态：${node.status}`,
    node.handoffGoal ? `- AI 接力目标：${node.handoffGoal}` : null,
    `- 摘要：${node.summary}`,
    `- 内容：${node.content}`,
    node.techNotes ? `- 技术备注：${node.techNotes}` : null,
  ].filter(Boolean).join('\n')).join('\n\n')

  return `请把以下 GameUX PRD 拆解结果生成一个可运行的交互原型。

要求：
- 生成一个完整前端原型，体现主要界面、导航路径、状态变化和用户反馈。
- 使用单文件 HTML/CSS/JS 或现代前端项目均可，但需要能直接运行预览。
- 优先实现已完成的 client/UI 文档包；如果没有已完成文档包，则从全部叶子文档中抽取可视化界面需求。
- 用游戏交互设计规格的方式呈现，不要做营销页。
- 所有用户可见界面文字、按钮文案、状态提示、组件标注和说明文字必须是中文；只有代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。

导图叶子文档包：
${specs || '暂无节点内容'}
`
}

export function openBoltWithPrompt(prompt: string) {
  const url = `https://bolt.new/?prompt=${encodeURIComponent(prompt)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
