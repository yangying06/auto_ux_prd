/**
 * JSON parsing and PrdNode field normalization helpers.
 *
 * Extracted from server/index.ts. Pure functions for safely parsing Claude
 * JSON responses and normalizing PRD node fields from AI tool-use payloads.
 */
import type {
  PrdNode,
  PrdNodeAudience,
  PrdNodeReference,
  PrdNodeSourceKind,
  PrdNodeStatus,
} from '../../src/types/prdNode'
import type { UXRequirementState } from '../../src/types/uxRequirement'

export function safeParseClaudeJson(text: string) {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { reply?: string; state_patch?: Partial<UXRequirementState> }
    } catch {
      // Try next candidate
    }
  }

  return { reply: stripJsonEcho(trimmed) }
}


export function stripJsonEcho(text: string) {
  const jsonStart = text.indexOf('{')
  return (jsonStart === -1 ? text : text.slice(0, jsonStart)).trim()
}

export function safeParseMapAdjustmentJson(text: string) {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  const candidate = firstBrace !== -1 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed
  try {
    return JSON.parse(candidate) as { reply?: string; operations?: unknown }
  } catch {
    return { reply: stripJsonEcho(trimmed), operations: [] }
  }
}


export function safeParseQaChatJson(text: string) {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  const candidate = firstBrace !== -1 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed
  try {
    return JSON.parse(candidate) as { reply?: string; readyToConfirm?: unknown; issuePatch?: unknown }
  } catch {
    return { reply: stripJsonEcho(trimmed), readyToConfirm: false, issuePatch: {} }
  }
}


export function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}


export function normalizeParentId(value: unknown): string | null {
  const text = normalizeTextValue(value)
  if (!text || text === 'null' || text === 'undefined' || text === '-') return null
  return text
}


export function normalizeNumberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}


export function normalizeNodeType(value: unknown): PrdNode['type'] {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (!text) return 'page'
  if (['page', 'screen', '页面', '界面', '弹窗', '模块页'].includes(text)) return 'page'
  if (['module', '模块', 'domain', 'category'].includes(text)) return 'module'
  if (['ui', 'interaction', 'control', '交互', '控件', '状态'].includes(text)) return 'ui'
  return 'feature'
}


export function normalizeNodeStatus(value: unknown, fallback: PrdNodeStatus): PrdNodeStatus {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (text === 'done' || text === '已确认' || text === 'completed') return 'done'
  if (text === 'pending_refine' || text === '待打磨' || text === 'refine') return 'pending_refine'
  if (text === 'pending' || text === '可导出') return 'pending'
  return fallback
}


export function normalizeNodeReferences(value: unknown): PrdNodeReference[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): PrdNodeReference | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const targetNodeId = normalizeTextValue(candidate.targetNodeId ?? candidate.target_node_id ?? candidate.targetId ?? candidate.target_id)
      const label = normalizeTextValue(candidate.label ?? candidate.title ?? candidate.name) ?? '跨页面引用'
      const reason = normalizeTextValue(candidate.reason ?? candidate.note ?? candidate.description)
      const sourceNodeId = normalizeTextValue(candidate.sourceNodeId ?? candidate.source_node_id ?? candidate.sourceId ?? candidate.source_id)
      return { targetNodeId, label, reason, sourceNodeId }
    })
    .filter((item): item is PrdNodeReference => item !== null && Boolean(item.label))
}


export function normalizeAudience(value: unknown): PrdNodeAudience | null {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (!text) return null
  if (['overview', 'project', '概览', '总览'].includes(text)) return 'overview'
  if (['client', 'frontend', '客户端', '前端', '表现层'].includes(text)) return 'client'
  if (['server', 'backend', '服务端', '后端'].includes(text)) return 'server'
  if (['config', '配置', '参数'].includes(text)) return 'config'
  if (['api', 'interface', '接口', '字段'].includes(text)) return 'api'
  if (['acceptance', 'qa', 'test', '验收', '测试', '质量'].includes(text)) return 'acceptance'
  if (['appendix', 'risk', 'tracking', '附录', '风险', '埋点'].includes(text)) return 'appendix'
  if (['model', '模型', '数据模型', '领域模型'].includes(text)) return 'model'
  if (['ctrl', 'controller', 'control', '控制', '控制器', '流程控制'].includes(text)) return 'ctrl'
  if (['view', 'ui', 'screen', '界面', '视图', '视觉层'].includes(text)) return 'view'
  return 'mixed'
}


export function normalizeSourceKind(value: unknown, fallback: PrdNodeSourceKind = 'prd'): PrdNodeSourceKind {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (['user', '用户', '用户补充'].includes(text ?? '')) return 'user'
  if (['upload', 'file', '上传', '上传资料'].includes(text ?? '')) return 'upload'
  return fallback
}
