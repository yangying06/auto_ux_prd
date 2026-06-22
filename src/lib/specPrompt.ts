import { formatSectionTitle, formatSpecLens, hasNodeSections, resolveNodeAudience, resolveNodeSpecLens } from './prdNodeLens'
import { formatPerformanceSpecForPrompt, formatPerformanceSpecMarkdown, resolveNodePerformanceSpec } from './performanceOrchestration'
import { buildDeliverySections, collectBackendContracts, collectDeliveryNodes } from './prdNodeDelivery'
import type { PrdNode, PrdTree } from '../types/prdNode'
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
- 不要生成提示性标注、组件标注、注释说明小标签、注释栏、引线或 callout；原型只保留用户真实会看到和操作的界面内容。
- 用户可见界面文字、按钮文案和状态提示必须跟随设计稿、截图、Figma、已有原型或用户明确要求的语言；证据是英文时保持英文，不要翻译。没有语言证据时，默认使用简洁中文占位文案；代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。

交互规格：
触发条件：${formatValue(requirement.trigger_condition)}
执行规则：${formatValue(requirement.sequence_rules)}
引擎约束：${formatValue(requirement.engine_constraints, '无特殊平台约束')}
完成度：${requirement.completion_rate}%

表现编排：
${requirement.performance_spec ? formatPerformanceSpecForPrompt(requirement.performance_spec) : '未提供单独表现编排；仅按执行规则生成关键状态反馈。'}

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

function formatNodeSectionsForPrompt(node: PrdNode) {
  if (!hasNodeSections(node.sections)) return null
  return [
    '- 页面规格视角：',
    ...(['view', 'interaction', 'data'] as const).map((key) => {
      const section = node.sections?.[key]
      if (!section?.summary && !section?.content) return null
      return [
        `  - ${section.title ?? formatSectionTitle(key)}`,
        section.summary ? `    摘要：${section.summary}` : null,
        section.content ? `    内容：${section.content}` : null,
      ].filter(Boolean).join('\n')
    }).filter((item): item is string => Boolean(item)),
  ].join('\n')
}

function uniqueNodes(nodes: PrdNode[]) {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false
    seen.add(node.id)
    return true
  })
}

function formatDeliverySectionsForPrompt(node: PrdNode, tree: PrdTree) {
  const sections = buildDeliverySections(node, tree)
  if (!sections.some((section) => section.status !== 'missing')) return formatNodeSectionsForPrompt(node)
  return [
    '- View / Flow / Data：',
    ...sections.map((section) => {
      if (section.status === 'missing') return null
      return [
        `  - ${section.title}`,
        section.summary ? `    摘要：${section.summary}` : null,
        section.content ? `    内容：${section.content}` : null,
        section.sourceNodeIds.length ? `    折叠来源：${section.sourceNodeIds.join(', ')}` : null,
      ].filter(Boolean).join('\n')
    }).filter((item): item is string => Boolean(item)),
  ].join('\n')
}

function formatBackendContractsForPrompt(node: PrdNode, tree: PrdTree) {
  const contracts = collectBackendContracts(node, tree)
  if (!contracts.length) return null
  return [
    '- 服务端交互 / 依赖引用：',
    ...contracts.map((contract) => [
      `  - ${contract.title} (${contract.kind})`,
      contract.summary ? `    说明：${contract.summary}` : null,
      contract.fields?.length ? `    字段：${contract.fields.join('、')}` : null,
      contract.targetNodeId ? `    目标节点：${contract.targetNodeId}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n')
}

export function prdTreeToBoltPrompt(tree: PrdTree) {
  const deliveryNodes = collectDeliveryNodes(tree)
  const completedDeliveryNodes = deliveryNodes.filter((node) => node.status === 'done')
  const visualDeliveryNodes = deliveryNodes.filter((node) => resolveNodeAudience(node) === 'client' || resolveNodeSpecLens(node) === 'view')
  const completedVisualDeliveryNodes = visualDeliveryNodes.filter((node) => node.status === 'done')
  const sourceNodes = uniqueNodes(
    completedVisualDeliveryNodes.length
      ? completedVisualDeliveryNodes
      : completedDeliveryNodes.length
        ? completedDeliveryNodes
        : visualDeliveryNodes.length
          ? visualDeliveryNodes
          : deliveryNodes,
  )

  const specs = sourceNodes.map((node) => [
    `## ${buildNodePath(node.id, tree)}`,
    `- 文档节点编号：${node.id}`,
    node.docPath ? `- 导出路径：${node.docPath}` : null,
    `- 面向角色：${resolveNodeAudience(node) ?? '未定'}`,
    `- 规格视角：${formatSpecLens(resolveNodeSpecLens(node))}`,
    `- 类型：${node.type}`,
    `- 状态：${node.status}`,
    node.handoffGoal ? `- AI 接力目标：${node.handoffGoal}` : null,
    `- 摘要：${node.summary}`,
    `- 内容：${node.content}`,
    formatDeliverySectionsForPrompt(node, tree),
    formatBackendContractsForPrompt(node, tree),
    formatPerformanceSpecMarkdown(resolveNodePerformanceSpec(node)),
    node.techNotes ? `- 技术备注：${node.techNotes}` : null,
  ].filter(Boolean).join('\n')).join('\n\n')

  return `请把以下 GameUX PRD 拆解结果生成一个可运行的交互原型。

要求：
- 生成一个完整前端原型，体现主要界面、导航路径、状态变化和用户反馈。
- 使用单文件 HTML/CSS/JS 或现代前端项目均可，但需要能直接运行预览。
- 优先实现已完成的 client/UI 文档包；如果没有已完成文档包，则从全部叶子文档中抽取可视化界面需求。
- 用游戏交互设计规格的方式呈现，不要做营销页。
- 不要生成提示性标注、组件标注、注释说明小标签、注释栏、引线或 callout；原型只保留用户真实会看到和操作的界面内容。
- 用户可见界面文字、按钮文案和状态提示必须跟随设计稿、截图、Figma、已有原型或用户明确要求的语言；证据是英文时保持英文，不要翻译。没有语言证据时，默认使用简洁中文占位文案；代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。

导图叶子文档包：
${specs || '暂无节点内容'}
`
}

const MAX_BOLT_PROMPT_URL_LENGTH = 60000

async function copyPromptToClipboard(prompt: string) {
  try {
    await navigator.clipboard?.writeText(prompt)
    return true
  } catch {
    return false
  }
}

export async function openBoltWithPrompt(prompt: string) {
  const url = `https://bolt.new/?prompt=${encodeURIComponent(prompt)}`
  const isUrlTooLong = url.length > MAX_BOLT_PROMPT_URL_LENGTH
  const targetUrl = isUrlTooLong ? 'https://bolt.new/' : url

  if (isUrlTooLong) {
    const copied = await copyPromptToClipboard(prompt)
    if (copied) {
      window.alert('当前导图内容较长，已复制 Bolt Prompt。即将打开 bolt.new，请在输入框中粘贴后生成原型。')
    } else {
      window.prompt('当前导图内容较长，无法通过 URL 直接传给 Bolt。请先复制这段 Prompt，再到 bolt.new 粘贴生成原型。', prompt)
    }
  }

  const popup = window.open('about:blank', '_blank')
  if (popup) {
    popup.opener = null
    popup.document.title = 'Opening Bolt...'
    popup.document.body.innerHTML = '<p style="font:14px system-ui;padding:24px">正在打开 bolt.new...</p>'
    popup.location.href = targetUrl
    return true
  }

  const copied = await copyPromptToClipboard(prompt)
  if (!copied) {
    window.prompt('浏览器阻止了新窗口，且无法自动复制。请手动复制这段 Prompt。', prompt)
  }
  const shouldOpenCurrentWindow = window.confirm(
    copied
      ? '浏览器阻止了新窗口，Bolt Prompt 已复制。是否在当前窗口打开 bolt.new？'
      : '浏览器阻止了新窗口。是否在当前窗口打开 bolt.new？',
  )
  if (shouldOpenCurrentWindow) {
    window.location.assign(targetUrl)
  }
  return false
}
