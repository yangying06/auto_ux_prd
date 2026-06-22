import type { PrdNode, PrdPerformanceSpec } from '../types/prdNode'
import type { ReusableLogicAsset, ReusableLogicAssetType } from '../types/reusableLogic'

const TYPE_LABELS: Record<ReusableLogicAssetType, string> = {
  interaction_state: '交互状态',
  animation_rule: '动画规则',
  feedback_pattern: '反馈模式',
  component_pattern: '组件模式',
  copywriting_pattern: '文案模式',
}

const TYPE_ORDER: ReusableLogicAssetType[] = [
  'interaction_state',
  'animation_rule',
  'feedback_pattern',
  'component_pattern',
  'copywriting_pattern',
]

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function unique(items: string[], limit = 10) {
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

function stableId(nodeId: string, type: ReusableLogicAssetType, key: string) {
  return `logic:${nodeId}:${type}:${key}`
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120)
}

function makeCandidate(
  node: PrdNode,
  type: ReusableLogicAssetType,
  field: string,
  name: string,
  description: string,
  logic: string,
  tags: string[],
): ReusableLogicAsset | null {
  const cleanLogic = normalizeText(logic)
  if (cleanLogic.length < 8) return null
  const now = new Date().toISOString()
  return {
    id: stableId(node.id, type, field),
    name: normalizeText(name) || `${node.label} ${TYPE_LABELS[type]}`,
    type,
    status: 'candidate',
    reuseMode: 'reference',
    description: normalizeText(description) || cleanLogic,
    logic: cleanLogic,
    usageGuidance: `适用于与「${node.label}」相似的触发、反馈或状态流转；复用前需确认资源、层级和结束状态是否匹配。`,
    tags: unique([node.label, TYPE_LABELS[type], ...tags], 8),
    source: {
      nodeId: node.id,
      nodeLabel: node.label,
      field,
      excerpt: cleanLogic.slice(0, 180),
    },
    createdAt: now,
    updatedAt: now,
  }
}

function sequenceSummary(spec: PrdPerformanceSpec) {
  return spec.sequence
    .map((step, index) => {
      const detail = [step.detail, step.layer ? `层级:${step.layer}` : null, step.waitFor ? `等待:${step.waitFor}` : null]
        .filter(Boolean)
        .join('；')
      return `${index + 1}. ${step.title}${detail ? `：${detail}` : ''}`
    })
    .join('\n')
}

export function reusableLogicTypeLabel(type: ReusableLogicAssetType) {
  return TYPE_LABELS[type]
}

export function deriveReusableLogicCandidates(node: PrdNode, performanceSpec: PrdPerformanceSpec | null): ReusableLogicAsset[] {
  if (!performanceSpec?.detected || performanceSpec.disabled) return []
  const candidates: Array<ReusableLogicAsset | null> = []
  const trigger = normalizeText(performanceSpec.trigger)
  const branches = unique(performanceSpec.branches, 6)
  const sequence = sequenceSummary(performanceSpec)
  const integrationModes = unique(performanceSpec.integrationModes ?? [], 6)
  const layers = unique(performanceSpec.layers, 6)
  const controls = unique(performanceSpec.controls, 6)
  const assets = unique(performanceSpec.assets, 8)
  const endState = normalizeText(performanceSpec.endState)
  const prototypeNotes = unique(performanceSpec.prototypeNotes, 6)

  if (trigger || branches.length || endState) {
    candidates.push(makeCandidate(
      node,
      'interaction_state',
      'state-flow',
      `${node.label} 状态流转`,
      '从草稿打磨中提取的触发、分支和结束状态规则。',
      [
        trigger ? `触发：${trigger}` : null,
        branches.length ? `分支：${branches.join('；')}` : null,
        endState ? `结束状态：${endState}` : null,
      ].filter(Boolean).join('\n'),
      ['状态流转', '触发', '分支'],
    ))
  }

  if (sequence || integrationModes.length || layers.length || assets.length) {
    candidates.push(makeCandidate(
      node,
      'animation_rule',
      'motion-sequence',
      `${node.label} 表现编排`,
      '可复用的播放顺序、接入方式、资源和层级约束。',
      [
        sequence ? `播放流程：\n${sequence}` : null,
        integrationModes.length ? `接入方式：${integrationModes.join('；')}` : null,
        layers.length ? `层级：${layers.join('；')}` : null,
        assets.length ? `资源：${assets.join('；')}` : null,
      ].filter(Boolean).join('\n'),
      ['表现编排', '动画', '资源'],
    ))
  }

  if (controls.length || prototypeNotes.length) {
    candidates.push(makeCandidate(
      node,
      'feedback_pattern',
      'feedback-control',
      `${node.label} 反馈控制`,
      '可复用的跳过、打断、重复触发、回滚和验收提示。',
      [
        controls.length ? `控制规则：${controls.join('；')}` : null,
        prototypeNotes.length ? `原型提示：${prototypeNotes.join('；')}` : null,
      ].filter(Boolean).join('\n'),
      ['反馈', '控制', '验收'],
    ))
  }

  return candidates
    .filter((item): item is ReusableLogicAsset => Boolean(item))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
}

export function formatReusableLogicAssetForPrompt(asset: ReusableLogicAsset) {
  return [
    `请复用资源库中已沉淀的表现逻辑「${asset.name}」。`,
    `类型：${reusableLogicTypeLabel(asset.type)}`,
    `复用方式：${asset.reuseMode === 'copy' ? '复制为当前节点实现' : '按引用规则复用'}`,
    `来源：${asset.source.nodeLabel} (${asset.source.nodeId}) / ${asset.source.field}`,
    `说明：${asset.description}`,
    `逻辑：\n${asset.logic}`,
    `复用注意：${asset.usageGuidance}`,
    asset.tags.length ? `标签：${asset.tags.join('、')}` : null,
    '生成资源库标准 HTML 时，应把这套表现逻辑映射到当前节点的真实界面底板、资源清单和状态分支，不要引入素材库清单外资源。',
  ].filter((line): line is string => Boolean(line)).join('\n')
}
