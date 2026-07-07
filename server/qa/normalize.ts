/**
 * QA-defect normalization and formatting helpers.
 *
 * Extracted from server/index.ts. These functions validate/normalize a
 * QaIssuePatch from model output and format QA issue context for prompts.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { QaAttachment, QaChatRequest, QaIssuePatch, QaIssuePriority, QaIssueSeverity } from '../../src/types/qa'
import { normalizeNullableString } from '../lib/statePatch'

/** Keep only non-empty trimmed strings from an array; undefined if not an array. */
export function normalizeQaTextArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => normalizeNullableString(item)).filter((item): item is string => Boolean(item))
}

export function normalizeQaSeverity(value: unknown): QaIssueSeverity | undefined {
  return value === 'blocker' || value === 'major' || value === 'minor' || value === 'trivial'
    ? value
    : undefined
}

export function normalizeQaPriority(value: unknown): QaIssuePriority | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined
}

export function normalizeQaConfidenceValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)))
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed))
  }
  return undefined
}

export function normalizeQaIssuePatch(value: unknown): QaIssuePatch {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const patch: QaIssuePatch = {}
  const title = normalizeNullableString(candidate.title)
  const description = normalizeNullableString(candidate.description)
  const expectedResult = normalizeNullableString(candidate.expectedResult ?? candidate.expected_result)
  const actualResult = normalizeNullableString(candidate.actualResult ?? candidate.actual_result)
  const environment = normalizeNullableString(candidate.environment)
  const aiSummary = normalizeNullableString(candidate.aiSummary ?? candidate.ai_summary)
  const suspectedCause = normalizeNullableString(candidate.suspectedCause ?? candidate.suspected_cause)
  const devSuggestion = normalizeNullableString(candidate.devSuggestion ?? candidate.dev_suggestion)
  const stepsToReproduce = normalizeQaTextArray(candidate.stepsToReproduce ?? candidate.steps_to_reproduce)
  const aiQuestions = normalizeQaTextArray(candidate.aiQuestions ?? candidate.ai_questions)
  const severity = normalizeQaSeverity(candidate.severity)
  const priority = normalizeQaPriority(candidate.priority)
  const aiConfidence = normalizeQaConfidenceValue(candidate.aiConfidence ?? candidate.ai_confidence)

  if (title) patch.title = title
  if (severity) patch.severity = severity
  if (priority) patch.priority = priority
  if (description) patch.description = description
  if (stepsToReproduce) patch.stepsToReproduce = stepsToReproduce
  if (expectedResult) patch.expectedResult = expectedResult
  if (actualResult) patch.actualResult = actualResult
  if (candidate.environment !== undefined) patch.environment = environment
  if (aiSummary) patch.aiSummary = aiSummary
  if (aiQuestions) patch.aiQuestions = aiQuestions
  if (aiConfidence !== undefined) patch.aiConfidence = aiConfidence
  if (candidate.suspectedCause !== undefined || candidate.suspected_cause !== undefined) patch.suspectedCause = suspectedCause
  if (candidate.devSuggestion !== undefined || candidate.dev_suggestion !== undefined) patch.devSuggestion = devSuggestion
  if (typeof candidate.readyToConfirm === 'boolean') patch.readyToConfirm = candidate.readyToConfirm
  if (typeof candidate.ready_to_confirm === 'boolean') patch.readyToConfirm = candidate.ready_to_confirm
  return patch
}

export function qaAttachmentToImageBlock(attachment: QaAttachment): Anthropic.ImageBlockParam | null {
  if (attachment.type !== 'image' || !attachment.dataUrl) return null
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/u.exec(attachment.dataUrl)
  const mediaType = attachment.mediaType ?? match?.[1]
  const data = match?.[2] ?? attachment.dataUrl
  if (
    mediaType !== 'image/png'
    && mediaType !== 'image/jpeg'
    && mediaType !== 'image/gif'
    && mediaType !== 'image/webp'
  ) {
    return null
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data,
    },
  }
}

export function formatQaNodeRefs(issue: QaChatRequest['issue']) {
  if (!issue.nodeRefs.length) return '未引用节点'
  return issue.nodeRefs.map((ref, index) => [
    `### 引用 ${index + 1}: ${ref.title}`,
    `- 节点 ID: ${ref.nodeId}`,
    `- 类型: ${ref.nodeType}`,
    `- 导出路径: ${ref.docPath ?? '未指定'}`,
    `- 摘要: ${ref.summary}`,
    ref.snapshot.handoffGoal ? `- AI 接力目标: ${ref.snapshot.handoffGoal}` : null,
    ref.snapshot.qualityGate ? `- 质量门槛: ${ref.snapshot.qualityGate}` : null,
    ref.snapshot.techNotes ? `- 技术备注: ${ref.snapshot.techNotes}` : null,
    `- 内容:\n${ref.content}`,
  ].filter(Boolean).join('\n')).join('\n\n')
}

export function formatQaAttachments(issue: QaChatRequest['issue']) {
  if (!issue.attachments.length) return '未上传附件'
  return issue.attachments.map((attachment, index) => {
    if (attachment.type === 'image') {
      return `${index + 1}. 图片：${attachment.name}（${attachment.mediaType ?? '未知类型'}）`
    }
    return `${index + 1}. ${attachment.name}\n${attachment.text ?? '无文本内容'}`
  }).join('\n\n')
}

export function formatQaIssueDraft(issue: QaChatRequest['issue']) {
  return [
    `标题: ${issue.title}`,
    `状态: ${issue.status}`,
    `严重程度: ${issue.severity}`,
    `优先级: ${issue.priority}`,
    `描述: ${issue.description || '未填写'}`,
    `复现步骤:\n${issue.stepsToReproduce.length ? issue.stepsToReproduce.map((step, index) => `${index + 1}. ${step}`).join('\n') : '未填写'}`,
    `预期结果: ${issue.expectedResult || '未填写'}`,
    `实际结果: ${issue.actualResult || '未填写'}`,
    `环境: ${issue.environment ?? '未填写'}`,
    `AI 摘要: ${issue.aiSummary || '未生成'}`,
    `疑似原因: ${issue.suspectedCause ?? '未判断'}`,
    `给程序的建议: ${issue.devSuggestion ?? '未生成'}`,
  ].join('\n')
}
