import type { ChatMessage } from '../types/chat'
import type { PrototypeAssetManifest } from '../types/prototypeAssets'
import type { PrototypeSpec, PrototypeSpecAssetPolicy, PrototypeSpecComponent } from '../types/prototypeSpec'
import type { PrdNode, PrdPerformanceSpec } from '../types/prdNode'
import type { ReusableLogicAsset } from '../types/reusableLogic'
import type { UIComponent, UXRequirementState } from '../types/uxRequirement'

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function unique(items: Array<string | null | undefined>, limit = 12) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const trimmed = normalizeText(item)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= limit) break
  }
  return result
}

function textFromMessage(content: ChatMessage['content']) {
  if (typeof content === 'string') return normalizeText(content)
  return normalizeText(content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'document') return `[资料] ${block.title}: ${block.context ?? ''}`
      return `[图片] ${block.source.media_type}`
    })
    .join(' '))
}

function recentSourceInputs(messages: ChatMessage[]) {
  return messages
    .slice(-8)
    .map((message) => {
      const text = textFromMessage(message.content)
      if (!text) return null
      return `${message.role === 'user' ? '用户' : 'AI'}: ${text}`.slice(0, 240)
    })
    .filter((item): item is string => Boolean(item))
}

function splitSpecLines(value: string | null | undefined, limit = 8) {
  return unique(
    normalizeText(value)
      .split(/(?:\n|。|；|;|\.\s+)/u)
      .map((line) => line.trim()),
    limit,
  )
}

function flattenUiComponents(components: UIComponent[], prefix = ''): PrototypeSpecComponent[] {
  return components.flatMap((component, index) => {
    const id = `${prefix}${index + 1}`
    const current: PrototypeSpecComponent = {
      id,
      name: component.name,
      type: component.type,
      role: component.notes ?? component.type,
      states: component.states,
      content: component.notes,
      assetRefs: [],
      constraints: [
        component.animation_in ? `入场: ${component.animation_in}` : null,
        component.animation_out ? `退场: ${component.animation_out}` : null,
        Number.isFinite(component.z_order) ? `层级: ${component.z_order}` : null,
      ].filter((item): item is string => Boolean(item)),
    }
    return [current, ...flattenUiComponents(component.children ?? [], `${id}.`)]
  })
}

function performanceLogicFromSpec(spec: PrdPerformanceSpec | null | undefined) {
  if (!spec?.detected || spec.disabled) return []
  return unique([
    spec.trigger ? `触发: ${spec.trigger}` : null,
    spec.branches.length ? `分支: ${spec.branches.join(' / ')}` : null,
    ...spec.sequence.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}${step.layer ? ` / 层级 ${step.layer}` : ''}${step.waitFor ? ` / 等待 ${step.waitFor}` : ''}`),
    spec.integrationModes?.length ? `接入方式: ${spec.integrationModes.join(' / ')}` : null,
    spec.assets.length ? `表现资源: ${spec.assets.join(' / ')}` : null,
    spec.layers.length ? `层级: ${spec.layers.join(' / ')}` : null,
    spec.controls.length ? `控制: ${spec.controls.join(' / ')}` : null,
    spec.endState ? `结束状态: ${spec.endState}` : null,
    ...spec.prototypeNotes.map((note) => `原型备注: ${note}`),
  ], 18)
}

function assetRefsFromRequirement(requirementState: UXRequirementState) {
  return requirementState.asset_dependencies
    .map((asset) => [asset.type, asset.path].filter(Boolean).join(': '))
    .filter(Boolean)
}

function assetRefsFromManifest(assetManifest?: PrototypeAssetManifest | null) {
  if (!assetManifest) return []
  return unique([
    ...assetManifest.assets.map((asset) => `${asset.kind}: ${asset.name} -> ${asset.url}`),
    ...(assetManifest.interfaceBlueprints ?? []).map((blueprint) => `interface blueprint: ${blueprint.name} (${blueprint.uiSpecPath ?? blueprint.uiSpecUrl ?? blueprint.id})`),
  ], 40)
}

function assetPolicyFromDraft(requirementState: UXRequirementState, assetManifest?: PrototypeAssetManifest | null): PrototypeSpecAssetPolicy {
  return {
    mode: assetManifest?.mode ?? 'open',
    allowedAssetRefs: unique([
      ...assetRefsFromRequirement(requirementState),
      ...assetRefsFromManifest(assetManifest),
    ], 40),
    forbidden: [
      '不要把 HTML 当作最终交付物；HTML 只用于预览验证 spec。',
      '不要伪造无法访问的本地路径、base64 图片或随机网络素材。',
    ],
    notes: assetManifest?.notes ?? [],
  }
}

function layoutStructureFromNode(node: PrdNode, requirementState: UXRequirementState) {
  return unique([
    node.summary,
    node.sections?.view?.summary,
    node.sections?.view?.content,
    ...splitSpecLines(requirementState.sequence_rules, 6),
  ], 8)
}

function dataBindingsFromNode(node: PrdNode, requirementState: UXRequirementState) {
  return unique([
    node.sections?.data?.summary,
    node.sections?.data?.content,
    ...splitSpecLines(node.techNotes, 4),
    ...requirementState.asset_dependencies.map((asset) => asset.path ? `${asset.type}: ${asset.path}` : asset.type),
  ], 10)
}

function openQuestionsFromNode(node: PrdNode, performanceSpec: PrdPerformanceSpec | null | undefined) {
  return unique([
    ...(node.sections?.view?.openQuestions ?? []),
    ...(node.sections?.interaction?.openQuestions ?? []),
    ...(node.sections?.data?.openQuestions ?? []),
    ...(performanceSpec?.openQuestions ?? []),
    performanceSpec?.blockingQuestion?.question,
  ], 10)
}

export function buildDraftPrototypeSpecFromNode(
  node: PrdNode,
  messages: ChatMessage[],
  requirementState: UXRequirementState,
  assetManifest?: PrototypeAssetManifest | null,
): PrototypeSpec {
  const performanceSpec = requirementState.performance_spec ?? node.performanceSpec ?? null
  const sourceInputs = recentSourceInputs(messages)
  const flow = splitSpecLines(requirementState.sequence_rules, 12)
  const trigger = normalizeText(requirementState.trigger_condition) || `生成 ${node.label} 的交互原型 spec`

  return {
    schemaVersion: 'prototype-spec.v1',
    id: `draft:${node.id}:${Date.now()}`,
    mode: 'draft',
    title: `${node.label} 草稿原型 Spec`,
    sourceNodeId: node.id,
    sourceNodeLabel: node.label,
    sourceSummary: normalizeText(node.summary) || normalizeText(node.content).slice(0, 240),
    sourceInputs,
    htmlRole: 'preview',
    intent: trigger,
    layout: {
      viewport: 'mobile 375x812 preview; HTML is only a render for review.',
      structure: layoutStructureFromNode(node, requirementState),
      visualReferences: unique(assetRefsFromRequirement(requirementState), 10),
    },
    components: flattenUiComponents(requirementState.ui_components),
    states: unique([
      node.status,
      ...splitSpecLines(node.sections?.interaction?.summary, 6),
      ...splitSpecLines(requirementState.next_question, 2),
    ], 10),
    interactions: [{
      trigger,
      flow,
      feedback: unique([
        ...performanceLogicFromSpec(performanceSpec),
        ...splitSpecLines(node.sections?.interaction?.content, 8),
      ], 14),
      edgeCases: unique([
        requirementState.missing_reasons.asset_dependencies,
        requirementState.missing_reasons.engine_constraints,
        ...openQuestionsFromNode(node, performanceSpec),
      ], 10),
    }],
    performanceLogic: performanceLogicFromSpec(performanceSpec),
    performanceSpec,
    assetPolicy: assetPolicyFromDraft(requirementState, assetManifest),
    dataBindings: dataBindingsFromNode(node, requirementState),
    platformConstraints: unique([
      requirementState.engine_constraints,
      node.techNotes,
      '保持 H5/Android/iOS/游戏客户端可实现，不依赖预览 HTML 的私有状态。',
    ], 8),
    acceptanceCriteria: unique([
      node.qualityGate,
      '草稿 HTML 预览能覆盖主流程、关键状态和可见反馈。',
      '正式交付以前必须通过资源库标准化，把素材引用收敛到白名单。',
    ], 8),
    openQuestions: openQuestionsFromNode(node, performanceSpec),
    standardizedFromSpecId: null,
    updatedAt: new Date().toISOString(),
  }
}

export function standardizePrototypeSpec(
  draftSpec: PrototypeSpec,
  assetManifest?: PrototypeAssetManifest | null,
  reusableLogicAssets: ReusableLogicAsset[] = assetManifest?.reusableLogicAssets ?? [],
): PrototypeSpec {
  const approvedLogic = reusableLogicAssets.filter((asset) => asset.status === 'approved')
  return {
    ...draftSpec,
    id: `standard:${draftSpec.sourceNodeId}:${Date.now()}`,
    mode: 'standard',
    title: `${draftSpec.sourceNodeLabel} 资源库标准 Spec`,
    sourceInputs: unique([
      ...draftSpec.sourceInputs,
      '已执行资源库标准化：HTML 仅作为正式 spec 的预览渲染。',
    ], 16),
    layout: {
      ...draftSpec.layout,
      visualReferences: unique([
        ...assetRefsFromManifest(assetManifest),
        ...draftSpec.layout.visualReferences,
      ], 40),
    },
    performanceLogic: unique([
      ...draftSpec.performanceLogic,
      ...approvedLogic.map((asset) => `${asset.name}: ${asset.logic}`),
    ], 24),
    assetPolicy: {
      mode: assetManifest?.mode ?? 'strict',
      allowedAssetRefs: assetRefsFromManifest(assetManifest),
      forbidden: [
        '正式 HTML 预览只能引用资源库白名单、Tailwind CDN 和明确允许的本地 runtime。',
        '缺失资源只能用占位状态表达，不能伪造图片、特效、字体或本地路径。',
        '交付给端上的是本 spec，不是 HTML 文件本身。',
      ],
      notes: unique([
        ...(assetManifest?.notes ?? []),
        ...approvedLogic.map((asset) => `复用表现逻辑: ${asset.name} / ${asset.reuseMode}`),
      ], 20),
    },
    acceptanceCriteria: unique([
      '正式 spec 已声明资源库白名单和不可用资源处理策略。',
      'HTML 预览与正式 spec 的状态、交互、表现逻辑一致。',
      ...draftSpec.acceptanceCriteria,
    ], 12),
    standardizedFromSpecId: draftSpec.id,
    updatedAt: new Date().toISOString(),
  }
}

export function mergeReusableLogicIntoPrototypeSpec(spec: PrototypeSpec, asset: ReusableLogicAsset): PrototypeSpec {
  return {
    ...spec,
    sourceInputs: unique([
      ...spec.sourceInputs,
      `已确认可沉淀表现逻辑: ${asset.name}`,
    ], 16),
    performanceLogic: unique([
      ...spec.performanceLogic,
      `${asset.name}: ${asset.logic}`,
    ], 24),
    assetPolicy: {
      ...spec.assetPolicy,
      notes: unique([
        ...spec.assetPolicy.notes,
        `已沉淀表现逻辑: ${asset.name} / ${asset.reuseMode}`,
        asset.usageGuidance,
      ], 20),
    },
    acceptanceCriteria: unique([
      ...spec.acceptanceCriteria,
      `复用 ${asset.name} 时必须保持当前节点的真实资源、层级和结束状态一致。`,
    ], 12),
    updatedAt: new Date().toISOString(),
  }
}

function formatList(title: string, items: string[]) {
  if (!items.length) return `### ${title}\n- 未提供`
  return `### ${title}\n${items.map((item) => `- ${item}`).join('\n')}`
}

export function formatPrototypeSpecForPrompt(spec: PrototypeSpec) {
  return [
    `## Prototype Spec（源事实）`,
    `Spec ID: ${spec.id}`,
    `模式: ${spec.mode === 'standard' ? '资源库标准 Spec' : '草稿 Spec'}`,
    `节点: ${spec.sourceNodeLabel} (${spec.sourceNodeId})`,
    `HTML 角色: ${spec.htmlRole}，仅用于预览、校验和对齐，不作为最终交付源文件。`,
    `目标: ${spec.intent}`,
    `摘要: ${spec.sourceSummary || '未提供'}`,
    formatList('来源输入', spec.sourceInputs),
    formatList('布局结构', spec.layout.structure),
    formatList('视觉/素材引用', spec.layout.visualReferences),
    formatList('状态', spec.states),
    formatList('交互流程', spec.interactions.flatMap((item) => [
      `触发: ${item.trigger}`,
      ...item.flow.map((step) => `流程: ${step}`),
      ...item.feedback.map((feedback) => `反馈: ${feedback}`),
      ...item.edgeCases.map((edge) => `边界: ${edge}`),
    ])),
    formatList('表现逻辑', spec.performanceLogic),
    formatList('数据绑定', spec.dataBindings),
    formatList('平台约束', spec.platformConstraints),
    formatList('验收标准', spec.acceptanceCriteria),
    `### 素材策略\n- 模式: ${spec.assetPolicy.mode}\n${spec.assetPolicy.allowedAssetRefs.map((item) => `- 允许: ${item}`).join('\n') || '- 允许: 未提供'}\n${spec.assetPolicy.forbidden.map((item) => `- 禁止: ${item}`).join('\n')}`,
    formatList('待确认问题', spec.openQuestions),
  ].join('\n\n')
}

export function prototypeSpecToMarkdown(spec: PrototypeSpec) {
  return [
    `# ${spec.title}`,
    '',
    formatPrototypeSpecForPrompt(spec),
  ].join('\n')
}
