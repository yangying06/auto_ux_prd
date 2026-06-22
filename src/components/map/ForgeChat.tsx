import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { FigmaFrameImportResponse } from '../../lib/api'
import { findLatestUserMessageIndex, getTextFromMessage } from '../../lib/chatRecall'
import { getClipboardImageFiles, readImageFileAsClipboardAttachment } from '../../lib/clipboardImages'
import { formatReusableLogicAssetForPrompt, reusableLogicTypeLabel } from '../../lib/reusableLogicSedimentation'
import type { PrototypeVersion } from '../../store/appStore'
import type {
  ChatMessage,
  ContentBlock,
  DocumentBlock,
  ImageBlock,
  ReferenceImageClassificationRequest,
  ReferenceImageClassificationResponse,
  ReferenceImageRole,
} from '../../types/chat'
import type { PrototypeVariant } from '../../types/prototypeVariant'
import type { PrdNodeOperationSuggestion, PrdPerformanceBlockingQuestion, PrdPerformanceSpec } from '../../types/prdNode'
import type { AssetWorkbenchState } from '../../types/assetWorkbench'
import type { PrototypeGenerationMode } from '../../types/prototypeAssets'
import { NodeOperationReview } from './NodeOperationReview'
import { PrototypeBoard } from '../state/PrototypeBoard'
import { PrototypeVariants } from '../state/PrototypeVariants'

interface ForgeChatProps {
  nodeId: string
  messages: ChatMessage[]
  nodeComplete: boolean
  prototypeHtml: string | null
  prototypeHistory: PrototypeVersion[]
  prototypeVariants: PrototypeVariant[]
  selectedVariantIndex: number
  isGeneratingPrototype: boolean
  isCancellingPrototype: boolean
  nodeOperationSuggestions: PrdNodeOperationSuggestion[]
  performanceSpec: PrdPerformanceSpec | null
  blockingQuestion: PrdPerformanceBlockingQuestion | null
  assetWorkbench: AssetWorkbenchState
  generationMode: PrototypeGenerationMode
  onGenerationModeChange: (mode: PrototypeGenerationMode) => void
  onSend: (content: ChatMessage['content'], options?: ForgeChatSendOptions) => void | Promise<void>
  onClassifyImageAttachment: (input: ReferenceImageClassificationRequest) => Promise<ReferenceImageClassificationResponse>
  onImportFigmaFrame: (input: { url: string }, options?: { generationMode?: PrototypeGenerationMode }) => Promise<FigmaFrameImportResponse>
  onOpenAssets?: () => void
  onApplyNodeOperationSuggestion: (suggestionId: string) => void
  onDismissNodeOperationSuggestion: (suggestionId: string) => void
  onGeneratePrototype: (instruction?: string, options?: { singlePrototypeOnly?: boolean; recordInstruction?: boolean; evidenceContent?: ChatMessage['content']; currentTurnOnly?: boolean; generationMode?: PrototypeGenerationMode; preferredInterfaceAssetId?: string | null; forceInterfaceBase?: boolean }) => boolean | Promise<boolean>
  onCancelPrototypeGeneration: () => void
  onRestorePrototype: (id: string) => void
  onClearPrototypeHistory: () => void
  onSelectVariant: (index: number) => void
  onRemoveLastTurn: () => ChatMessage | null
  onClearChat: () => void
}

type PromptSkill = {
  id: string
  label: string
  hint: string
  detail: string
  keywords: string[]
}

interface ImageAttachment {
  id: string
  name: string
  role: ReferenceImageRole
  reason: string
  mediaType: ImageBlock['source']['media_type']
  data: string
  previewUrl: string
}

interface QuestionReply {
  label: string
  text: string
}

interface ForgeChatSendOptions {
  performancePolishMode?: boolean
  suppressUserEcho?: boolean
  generationMode?: PrototypeGenerationMode
}

const CHAT_WRAP_ANYWHERE_CLASS = 'break-words [overflow-wrap:anywhere]'
const CHAT_CODE_BLOCK_CLASS = `max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-sm font-mono text-[11px] leading-relaxed text-zinc-100 ${CHAT_WRAP_ANYWHERE_CLASS}`

const PROMPT_SKILLS: PromptSkill[] = [
  {
    id: 'source',
    label: '原文定位',
    hint: '位置、引用、缺口',
    detail: '请补齐当前文档包的原文定位：列出涉及的 PRD 标题、段落、字段名、截图位置，标注哪些结论来自原文、哪些是推断，并指出仍缺失或需要业务确认的证据。',
    keywords: ['原文', '位置', '证据', '引用'],
  },
  {
    id: 'boundary',
    label: '职责边界',
    hint: '负责/不负责',
    detail: '请梳理当前交互节点的职责边界：说明它负责什么、不负责什么、与父页面、子模块、后端、客户端表现的交接点，以及超出边界时应该转交给哪个节点。',
    keywords: ['职责', '边界', '范围', '交接'],
  },
  {
    id: 'fields',
    label: '依赖字段',
    hint: '字段、默认值、降级',
    detail: '请补齐依赖字段和数据条件：列出每个 UI 状态、按钮、弹窗、动效或跳转依赖的数据字段、默认值、空值/异常值处理，以及字段缺失时的降级表现。',
    keywords: ['字段', '依赖', '数据', '默认值'],
  },
  {
    id: 'motion-integration',
    label: '动效接入',
    hint: 'Tween/Spine/粒子/Prefab/音效',
    detail: '请按目标平台实际接入方式澄清当前节点的表现编排：先判断触发、分支、播放顺序、接入方式、资源、层级、控制、结束状态这 8 个槽位分别是已确认、AI 推断还是缺失；然后只问当前最阻塞实现的 1 个问题，并说明它卡住的是哪个槽位。接入方式可包含 CSS/原生动画、Tween、平台动画资源、Spine、粒子/特效资源、组件/弹窗特效、序列帧或音效联动。',
    keywords: ['动效', '表现', '接入', 'Tween', 'Spine', '粒子', 'Prefab', '音效', 'AnimationClip'],
  },
  {
    id: 'acceptance',
    label: '验收门槛',
    hint: '步骤、期望、判定',
    detail: '请把当前节点拆成可验收条目：每条包含触发前置条件、操作步骤、期望 UI/数据结果、失败状态和可自动化或人工验证的判定标准。',
    keywords: ['验收', '测试', '质量', '门槛'],
  },
  {
    id: 'state-flow',
    label: '状态流转',
    hint: '加载、失败、保持',
    detail: '请梳理完整状态流转：覆盖默认、加载中、成功、失败、空数据、禁用、重复点击、网络恢复和返回/关闭后的状态保持规则。',
    keywords: ['状态', '流转', 'loading', '失败'],
  },
  {
    id: 'fallback',
    label: '异常兜底',
    hint: '超时、失败、回滚',
    detail: '请补齐异常与兜底策略：列出超时、接口失败、资源缺失、权限不足、并发操作、离线/弱网、用户取消时的提示、重试和状态回滚规则。',
    keywords: ['异常', '兜底', '错误', '弱网'],
  },
  {
    id: 'tracking',
    label: '埋点指标',
    hint: '事件、属性、边界',
    detail: '请整理埋点与度量需求：列出关键曝光、点击、失败、完成、停留时长事件，给出事件名建议、触发时机、属性字段和不应重复上报的边界。',
    keywords: ['埋点', '指标', '事件', '数据'],
  },
  {
    id: 'handoff',
    label: '交付上下文',
    hint: '目标、规则、下一步',
    detail: '请整理成后续 AI 或开发可直接执行的交付上下文：包含目标、范围、已确认规则、未确认问题、依赖资源、验收门槛和建议的下一步任务顺序。',
    keywords: ['交付', '上下文', 'AI', '开发'],
  },
  {
    id: 'split',
    label: '节点拆分',
    hint: '新增/更新建议',
    detail: '请判断当前文档包是否需要拆分节点：指出过大、跨职责或证据混杂的部分，建议新增或更新的节点名称、父子关系、摘要和迁移的原文依据。',
    keywords: ['拆分', '节点', '导图', '结构'],
  },
  {
    id: 'visual',
    label: 'UI证据',
    hint: '布局、状态、反例',
    detail: '请基于已上传参考图补齐 UI 证据：逐项描述布局、层级、控件状态、动效、视觉差异和反例约束，并明确哪些结论不能仅凭图片确认。',
    keywords: ['UI', '截图', '参考图', '视觉'],
  },
]
const MAX_ATTACHMENTS = 6
const MAX_IMAGE_SIZE = 4 * 1024 * 1024

interface FigmaImportProgress {
  value: number
  status: string
  detail: string
}

const FIGMA_IMPORT_STAGES = [
  { value: 8, status: '解析 Figma Frame 链接', detail: '正在确认 file key、node id 和服务参数。' },
  { value: 24, status: '读取 Figma 节点树', detail: '正在从 Figma 直接获取选中 Frame 和可见子节点。' },
  { value: 42, status: '导出 Figma 子图', detail: '正在逐张渲染 Frame、模块和大面积视觉层，并去除示例数值。' },
  { value: 62, status: '下载视觉证据', detail: '正在把临时图片转为当前节点可用的参考图。' },
  { value: 82, status: '归一到生成管线', detail: '正在把 Figma 子图、节点文档和当前模式一起交给原型生成。' },
  { value: 88, status: '等待 Figma 返回', detail: '复杂 Frame 可能需要降倍率重试，成功后会继续流式刷新右侧预览。' },
]

const GENERATION_MODE_OPTIONS: Array<{
  id: PrototypeGenerationMode
  label: string
  icon: string
  title: string
}> = [
  {
    id: 'draft_preview',
    label: '草稿预览',
    icon: 'auto_awesome',
    title: '用 PRD、对话、图片或 Figma 快速生成可验证草稿。',
  },
  {
    id: 'resource_standard',
    label: '资源库标准',
    icon: 'inventory_2',
    title: '只能使用资源库允许资源和规范底板，清单外引用会被标为错误。',
  },
]

function interfacePackageLabel(row: AssetWorkbenchState['uiRows'][number]) {
  const imageCount = row.result?.imageCount ?? row.result?.assetCount ?? 0
  const suffix = imageCount > 0 ? ` · ${imageCount} 图` : ''
  return `${row.name || row.result?.panelName || '未命名界面'}${suffix}`
}

function buildFigmaImportProgress(elapsedMs: number): FigmaImportProgress {
  if (elapsedMs > 90000) {
    return {
      value: 93,
      status: 'Figma 仍在处理',
      detail: '正在保留已成功的子图并跳过超时节点；如果失败，请选中更小的 Frame 重试。',
    }
  }
  if (elapsedMs > 45000) {
    return {
      value: 91,
      status: 'Figma 渲染较慢',
      detail: '正在逐张导出并自动降低倍率，避免大图超时拖垮整次导入。',
    }
  }
  const value = Math.min(88, Math.round(8 + elapsedMs / 260))
  let stage = FIGMA_IMPORT_STAGES[0]
  for (const item of FIGMA_IMPORT_STAGES) {
    if (value >= item.value) stage = item
  }
  return { ...stage, value }
}

function AnimatedGeneratingText() {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDotCount((current) => current >= 3 ? 1 : current + 1)
    }, 420)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span className="inline-flex min-w-[72px] font-semibold text-primary">
      生成中{'.'.repeat(dotCount)}
    </span>
  )
}

function FigmaImportProgressPanel({ progress, sourceUrl }: { progress: FigmaImportProgress; sourceUrl: string }) {
  return (
    <div className="mb-sm shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-md py-sm">
      <div className="flex items-start justify-between gap-sm">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-xs text-label-md font-semibold text-primary">
            <span className="material-symbols-outlined animate-spin" style={{ fontSize: '16px' }}>sync</span>
            <AnimatedGeneratingText />
          </div>
          <div className="mt-1 truncate text-body-sm text-on-surface-variant">
            {progress.status} · {progress.detail}
          </div>
          <div className={`mt-xs font-mono text-[10px] text-on-surface-variant ${CHAT_WRAP_ANYWHERE_CLASS}`} title={sourceUrl}>
            {sourceUrl || '等待 Figma Frame 链接'}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-primary">{progress.value}%</span>
      </div>

      <div className="mt-sm">
        <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress.value}%` }}
          />
        </div>
      </div>
    </div>
  )
}



function roleLabel(role: ReferenceImageRole) {
  if (role === 'asset_reuse') return '素材复用'
  if (role === 'state_screenshot') return '状态截图'
  if (role === 'negative_reference') return '反例参考'
  return '布局参考'
}

function roleTone(role: ReferenceImageRole) {
  if (role === 'asset_reuse') return 'border-tertiary/40 bg-tertiary-container/20 text-tertiary'
  if (role === 'state_screenshot') return 'border-secondary/40 bg-secondary/10 text-secondary'
  if (role === 'negative_reference') return 'border-error/40 bg-error/10 text-error'
  return 'border-primary/40 bg-primary/10 text-primary'
}

function getSlashQuery(text: string) {
  const match = /(?:^|\s)\/([^\s/]*)$/u.exec(text)
  return match ? match[1] : null
}

function skillMatchesQuery(skill: PromptSkill, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [skill.id, skill.label, skill.hint, ...skill.keywords].some((item) => (
    item.toLowerCase().includes(normalized)
  ))
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*.+?\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-on-surface">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="break-all rounded bg-surface-container-high px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
    }
    return part
  })
}

function renderMarkdownText(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactElement[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let orderedList = false
  let codeLines: string[] | null = null

  function flushParagraph() {
    if (!paragraph.length) return
    blocks.push(
      <p key={`p-${blocks.length}`} className={`leading-relaxed ${CHAT_WRAP_ANYWHERE_CLASS}`}>
        {renderInlineMarkdown(paragraph.join(' '))}
      </p>,
    )
    paragraph = []
  }

  function flushList() {
    if (!list.length) return
    const Tag = orderedList ? 'ol' : 'ul'
    blocks.push(
      <Tag key={`list-${blocks.length}`} className={`space-y-1 pl-md leading-relaxed ${orderedList ? 'list-decimal' : 'list-disc'} ${CHAT_WRAP_ANYWHERE_CLASS}`}>
        {list.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
      </Tag>,
    )
    list = []
  }

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (codeLines) {
        blocks.push(
          <pre key={`code-${blocks.length}`} className={CHAT_CODE_BLOCK_CLASS}>
            <code>{codeLines.join('\n')}</code>
          </pre>,
        )
        codeLines = null
      } else {
        flushParagraph()
        flushList()
        codeLines = []
      }
      return
    }

    if (codeLines) {
      codeLines.push(line)
      return
    }

    if (!trimmed) {
      flushParagraph()
      flushList()
      return
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const className = level === 1 ? 'text-title-md' : level === 2 ? 'text-label-lg' : 'text-label-md'
      blocks.push(
        <div key={`h-${blocks.length}`} className={`${className} font-semibold text-on-surface ${CHAT_WRAP_ANYWHERE_CLASS}`}>
          {renderInlineMarkdown(heading[2])}
        </div>,
      )
      return
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed)
    if (unordered || ordered) {
      flushParagraph()
      const nextOrdered = Boolean(ordered)
      if (list.length && orderedList !== nextOrdered) flushList()
      orderedList = nextOrdered
      list.push((unordered ?? ordered)?.[1] ?? trimmed)
      return
    }

    paragraph.push(trimmed)
  })

  flushParagraph()
  flushList()
  const trailingCodeLines = codeLines as string[] | null
  if (trailingCodeLines) {
    blocks.push(
      <pre key={`code-${blocks.length}`} className={CHAT_CODE_BLOCK_CLASS}>
        <code>{trailingCodeLines.join('\n')}</code>
      </pre>,
    )
  }

  return <div className={`flex flex-col gap-xs whitespace-normal ${CHAT_WRAP_ANYWHERE_CLASS}`}>{blocks}</div>
}

function renderMessageContent(content: ChatMessage['content']) {
  if (typeof content === 'string') return renderMarkdownText(content)

  const textBlocks = content.filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
  const imageBlocks = content.filter((b): b is ImageBlock => b.type === 'image')
  const documentBlocks = content.filter((b): b is DocumentBlock => b.type === 'document')

  return (
    <div className={`flex min-w-0 max-w-full flex-col gap-sm ${CHAT_WRAP_ANYWHERE_CLASS}`}>
      {textBlocks.map((block, index) => (
        <div key={`text-${index}`} className={`min-w-0 max-w-full ${CHAT_WRAP_ANYWHERE_CLASS}`}>{renderMarkdownText(block.text)}</div>
      ))}
      {documentBlocks.length > 0 ? (
        <div className="flex flex-col gap-xs">
          {documentBlocks.map((block, index) => (
            <div key={`document-${index}`} className="flex min-w-0 items-start gap-xs rounded-lg border border-outline-variant/50 bg-surface-container-low px-sm py-xs text-label-md">
              <span className="material-symbols-outlined shrink-0 text-on-surface-variant" style={{ fontSize: '18px' }}>description</span>
              <div className="min-w-0">
                <div className={`font-medium text-on-surface ${CHAT_WRAP_ANYWHERE_CLASS}`}>{block.title}</div>
                {block.context ? (
                  <div className={`text-[11px] text-on-surface-variant ${CHAT_WRAP_ANYWHERE_CLASS}`}>{block.context}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {imageBlocks.length > 0 ? (
        <div className="grid grid-cols-2 gap-xs">
          {imageBlocks.map((block, index) => (
            <img
              key={`image-${index}`}
              src={`data:${block.source.media_type};base64,${block.source.data}`}
              alt="参考图"
              className="h-28 w-full rounded-lg border border-outline-variant/40 object-cover"
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function MessageBubble({
  msg,
  canRemove,
  onRecall,
  onClear,
}: {
  msg: ChatMessage
  canRemove?: boolean
  onRecall?: () => void
  onClear?: () => void
}) {
  if (msg.role === 'user') {
    return (
      <div className={`min-w-0 max-w-[78%] self-end rounded-2xl rounded-tr-sm bg-secondary-container px-md py-sm text-body-md text-on-secondary-container ${CHAT_WRAP_ANYWHERE_CLASS}`}>
        {renderMessageContent(msg.content)}
        {canRemove ? (
          <div className="mt-xs flex justify-end gap-xs border-t border-secondary/20 pt-xs">
            <button
              type="button"
              onClick={onRecall}
              className="rounded px-xs py-[2px] text-[11px] text-on-secondary-container/70 transition-colors hover:bg-secondary/10 hover:text-secondary"
              title="撤回这条消息并回填到输入框"
            >
              撤回
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded px-xs py-[2px] text-[11px] text-on-secondary-container/70 transition-colors hover:bg-error/10 hover:text-error"
              title="清理这条消息"
            >
              清理
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`min-w-0 max-w-[84%] self-start rounded-2xl rounded-tl-sm bg-surface-container px-md py-sm text-body-md text-on-surface animate-fade-in ${CHAT_WRAP_ANYWHERE_CLASS}`}>
      {renderMessageContent(msg.content)}
    </div>
  )
}

function LoadingIndicator() {
  return (
    <div className="flex gap-xs self-start">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 animate-bounce rounded-full bg-secondary"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}

function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-sm rounded-lg bg-error-container px-md py-sm text-body-md text-on-error-container">
      <span className={`min-w-0 ${CHAT_WRAP_ANYWHERE_CLASS}`}>{error}</span>
      <button onClick={onDismiss} className="shrink-0 font-bold text-on-error-container hover:opacity-80">
        ×
      </button>
    </div>
  )
}

function errorMessageFromUnknown(error: unknown, fallback = '原型更新失败，请重试。') {
  return error instanceof Error && error.message ? error.message : fallback
}

function isAbortError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && String((error as { name?: unknown }).name) === 'AbortError'
}

function countMessageImages(messages: ChatMessage[]) {
  return messages.reduce((count, message) => {
    if (typeof message.content === 'string') return count
    return count + message.content.filter((block) => block.type === 'image').length
  }, 0)
}

function messageText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content.trim()
  return content
    .map((block) => {
      if (block.type === 'text') return block.text.trim()
      if (block.type === 'document') return [`附件：${block.title}`, block.context].filter(Boolean).join('\n')
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function messageImages(content: ChatMessage['content']) {
  if (typeof content === 'string') return []
  return content.filter((block): block is ImageBlock => block.type === 'image')
}

function roleFromRecalledLine(line: string): ReferenceImageRole {
  if (line.includes('asset_reuse')) return 'asset_reuse'
  if (line.includes('state_screenshot')) return 'state_screenshot'
  if (line.includes('negative_reference')) return 'negative_reference'
  return 'layout_reference'
}

function stripRecalledAttachmentLines(text: string) {
  return text
    .replace(/\n\n[^\n]*(?:layout_reference|asset_reuse|state_screenshot|negative_reference)[\s\S]*$/u, '')
    .trim()
}

function recalledImageAttachments(content: ChatMessage['content']): ImageAttachment[] {
  const text = getTextFromMessage(content)
  const roleLines = text.split('\n').filter((line) => /^\s*\d+\.\s/.test(line))
  return messageImages(content).map((block, index) => ({
    id: `recalled-forge-${Date.now()}-${index}`,
    name: `recalled-forge-image-${index + 1}`,
    role: roleFromRecalledLine(roleLines[index] ?? ''),
    reason: '',
    mediaType: block.source.media_type,
    data: block.source.data,
    previewUrl: `data:${block.source.media_type};base64,${block.source.data}`,
  }))
}

function latestAssistantText(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const text = messageText(message.content)
    if (text) return text
  }
  return ''
}

function visualResourceReplies(latestAssistant: string, hasPrototype: boolean): QuestionReply[] {
  if (!/(原型|Figma|参考图|截图|视觉稿|视觉资源)/i.test(latestAssistant)) return []
  if (!/(上传|粘贴|提供|可以作为|作为当前界面)/.test(latestAssistant)) return []

  if (hasPrototype) {
    return [
      { label: '可作依据', text: '右侧原型可以作为当前界面的视觉依据，请继续打磨主流程、状态边界和验收标准。' },
      { label: '仅作参考', text: '右侧原型只作为布局参考，交互逻辑仍以 PRD 文本为准。' },
      { label: '稍后补图', text: '我稍后补充更准确的视觉参考图，请先按文字继续打磨。' },
    ]
  }

  return [
    { label: '没有资源', text: '没有原型资源，先按当前 PRD 文字打磨。' },
    { label: '稍后上传', text: '我稍后上传参考图，先不要进入表现编排。' },
    { label: '按文字推进', text: '先按当前 PRD 文本推进，视觉细节后续补充。' },
  ]
}

function performanceReplies(blockingQuestion: PrdPerformanceBlockingQuestion | null): QuestionReply[] {
  if (!blockingQuestion) return []

  const bySlot: Record<PrdPerformanceBlockingQuestion['slot'], QuestionReply[]> = {
    trigger: [
      { label: '接口返回后', text: '这个表现由接口/结算结果返回后触发。' },
      { label: '用户点击后', text: '这个表现由用户点击当前操作按钮后触发。' },
      { label: '状态变化后', text: '这个表现由页面状态或字段变化自动触发。' },
      { label: '我来描述', text: '触发条件我补充如下：' },
    ],
    branches: [
      { label: '统一流程', text: '不同结果先复用同一套表现流程。' },
      { label: '按等级分支', text: '按结果等级/奖励档位播放不同表现。' },
      { label: '异常单独处理', text: '成功、失败和异常状态需要拆成不同表现。' },
      { label: '我来描述', text: '分支规则我补充如下：' },
    ],
    sequence: [
      { label: '高亮后弹窗', text: '播放顺序是先高亮命中/目标区域，再打开结果弹窗。' },
      { label: '数值后飞入', text: '播放顺序是先展示数值变化，再播放资源飞入并刷新终态。' },
      { label: '逐段等待', text: '各阶段需要按顺序播放，上一段完成后再进入下一段。' },
      { label: '并行后收尾', text: '主要表现可以并行播放，全部结束后统一进入收尾状态。' },
    ],
    integrationModes: [
      { label: '动效+粒子', text: '接入方式优先使用平台动效控制位移/缩放，并叠加粒子或特效资源。' },
      { label: 'Animation/Spine', text: '核心表现使用 AnimationClip 或 Spine/Skeleton 资源播放。' },
      { label: 'Prefab 承载', text: '表现由独立 Prefab/弹窗承载，实例化到指定 UI 层级。' },
      { label: '先占位', text: '资源未定，先用占位动画实现，后续替换正式资源。' },
    ],
    assets: [
      { label: '资源已准备', text: '表现资源已准备，资源名/路径如下：' },
      { label: '资源待补', text: '表现资源还未确认，当前先用占位资源并在文档中标记待补。' },
      { label: '复用现有', text: '优先复用项目内已有的 prefab/动画/音效资源。' },
      { label: '缺失降级', text: '资源缺失时降级为静态高亮或简化动效。' },
    ],
    layers: [
      { label: 'UIEffect', text: '表现播放在 UIEffect 层，避免影响原界面布局。' },
      { label: '原界面内', text: '表现直接在原界面组件位置播放。' },
      { label: 'PopUp/Dialog', text: '弹窗类表现放在 PopUp/Dialog 层。' },
      { label: 'HUD 层', text: '资产/数值飞入类表现落到 HUD 资产层。' },
    ],
    controls: [
      { label: '禁止重复', text: '表现播放期间禁止重复触发同类操作。' },
      { label: '合并触发', text: '重复触发时合并结果，只播放一条连续表现。' },
      { label: '允许跳过', text: '允许用户跳过表现，跳过后直接进入最终状态。' },
      { label: '打断回滚', text: '表现被打断时停止播放并回滚到可操作状态。' },
    ],
    endState: [
      { label: '结束后刷新', text: '全部表现播放完成后刷新数值、按钮和列表状态。' },
      { label: '关闭后刷新', text: '用户关闭弹窗/结果层后再刷新页面状态。' },
      { label: '先刷新再播', text: '先刷新最终数值，再播放表现作为反馈。' },
      { label: '保持当前页', text: '播放完成后保持当前页面，不自动跳转。' },
    ],
  }

  return bySlot[blockingQuestion.slot]
}

function clampUnderstandingScore(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function performanceUnderstandingLabel(spec: PrdPerformanceSpec | null) {
  if (!spec) return '表现未开始'
  if (spec.disabled || spec.readiness?.level === 'waived') return '表现已豁免'
  if (spec.readiness?.level === 'ready') return '表现已确认'
  if (spec.readiness?.level === 'risk') return '表现有风险'
  if (spec.readiness?.level === 'blocked') return '表现阻塞'
  return spec.detected ? '表现评估中' : '表现未识别'
}

function getOverallUnderstanding(input: {
  messages: ChatMessage[]
  nodeComplete: boolean
  imageEvidenceCount: number
  prototypeHtml: string | null
  performanceSpec: PrdPerformanceSpec | null
}) {
  const documentScore = input.nodeComplete
    ? 88
    : input.messages.length > 2
      ? 68
      : input.messages.length > 1
        ? 52
        : 34
  const visualScore = Math.max(
    input.imageEvidenceCount > 0 ? 76 : 38,
    input.prototypeHtml ? 72 : 0,
  )
  const performanceScore = clampUnderstandingScore(
    input.performanceSpec?.readiness?.score ?? input.performanceSpec?.confidence ?? 45,
  )
  const score = clampUnderstandingScore(
    documentScore * 0.45 + visualScore * 0.25 + performanceScore * 0.3,
  )
  const confirmedCount = input.performanceSpec?.readiness?.confirmedSlots.length ?? 0
  const unresolvedCount = input.performanceSpec?.readiness
    ? input.performanceSpec.readiness.inferredSlots.length + input.performanceSpec.readiness.missingSlots.length
    : 0
  const label = score >= 80
    ? '整体清晰'
    : score >= 60
      ? '可继续打磨'
      : '需要补证据'

  return {
    score,
    label,
    confirmedCount,
    unresolvedCount,
    detail: `文档 ${documentScore}% / 视觉 ${visualScore}% / ${performanceUnderstandingLabel(input.performanceSpec)} ${performanceScore}%`,
  }
}

function performanceSlotLabel(slot: PrdPerformanceBlockingQuestion['slot']) {
  const labels: Record<PrdPerformanceBlockingQuestion['slot'], string> = {
    trigger: '触发条件',
    branches: '分支规则',
    sequence: '播放顺序',
    integrationModes: '接入方式',
    assets: '资源清单',
    layers: '层级位置',
    controls: '控制规则',
    endState: '结束状态',
  }
  return labels[slot]
}

function latestUserPrototypeInstruction(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const text = messageText(message.content)
    if (text) return text.slice(0, 1400)
  }
  return null
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(String(event.target?.result ?? '').trim())
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败。`))
    reader.readAsText(file)
  })
}

function buildDocumentAttachment(fileName: string, text: string): DocumentBlock {
  return {
    type: 'document',
    title: fileName,
    context: 'User-uploaded polishing material. Read it as attached evidence; do not pre-parse it as a map adjustment task.',
    source: {
      type: 'text',
      media_type: 'text/plain',
      data: text,
    },
  }
}

function isSupportedImageMediaType(type: string): type is ImageBlock['source']['media_type'] {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/gif' || type === 'image/webp'
}

export function ForgeChat({
  nodeId: _nodeId,
  messages,
  nodeComplete,
  prototypeHtml,
  prototypeHistory,
  prototypeVariants,
  selectedVariantIndex,
  isGeneratingPrototype,
  isCancellingPrototype,
  nodeOperationSuggestions,
  performanceSpec,
  blockingQuestion,
  assetWorkbench,
  generationMode,
  onGenerationModeChange,
  onSend,
  onClassifyImageAttachment,
  onImportFigmaFrame,
  onOpenAssets,
  onApplyNodeOperationSuggestion,
  onDismissNodeOperationSuggestion,
  onGeneratePrototype,
  onCancelPrototypeGeneration,
  onRestorePrototype,
  onClearPrototypeHistory,
  onSelectVariant,
  onRemoveLastTurn,
  onClearChat,
}: ForgeChatProps) {
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [isClassifying, setIsClassifying] = useState(false)
  const [variantView, setVariantView] = useState<'grid' | 'single'>('single')
  const [singlePrototypeOnly, setSinglePrototypeOnly] = useState(true)
  const [performancePolishMode, setPerformancePolishMode] = useState(false)
  const [selectedInterfaceAssetId, setSelectedInterfaceAssetId] = useState('')
  const [selectedReusableLogicAssetId, setSelectedReusableLogicAssetId] = useState('')
  const [showFigmaImporter, setShowFigmaImporter] = useState(false)
  const [figmaUrl, setFigmaUrl] = useState('')
  const [isImportingFigma, setIsImportingFigma] = useState(false)
  const [figmaImportProgress, setFigmaImportProgress] = useState<FigmaImportProgress | null>(null)

  const hasMultipleVariants = prototypeVariants.length > 1
  const selectedPrototypeVariant = prototypeVariants.find((variant) => variant.index === selectedVariantIndex) ?? null
  const selectedPrototypeHtml = selectedPrototypeVariant?.html ?? prototypeHtml
  const assetAuditErrorCount = selectedPrototypeVariant?.assetAudit?.filter((issue) => issue.severity === 'error').length ?? 0
  const assetAuditWarningCount = selectedPrototypeVariant?.assetAudit?.filter((issue) => issue.severity === 'warning').length ?? 0
  const readyInterfacePackages = useMemo(() => (
    assetWorkbench.uiRows.filter((row) => row.kind === 'interface' && row.status === 'ready' && Boolean(row.result?.html?.trim()))
  ), [assetWorkbench.uiRows])
  const selectedInterfacePackage = readyInterfacePackages.find((row) => row.id === selectedInterfaceAssetId) ?? readyInterfacePackages[0] ?? null
  const approvedReusableLogicAssets = useMemo(() => (
    assetWorkbench.reusableLogicAssets.filter((asset) => asset.status === 'approved')
  ), [assetWorkbench.reusableLogicAssets])
  const selectedReusableLogicAsset = approvedReusableLogicAssets.find((asset) => asset.id === selectedReusableLogicAssetId)
    ?? approvedReusableLogicAssets[0]
    ?? null

  // Whenever a fresh batch of variants arrives, default back to the comparison grid so the
  // user can choose; collapse to single preview when there is at most one variant.
  useEffect(() => {
    setVariantView(prototypeVariants.length > 1 ? 'grid' : 'single')
  }, [prototypeVariants])

  useEffect(() => {
    if (generationMode === 'resource_standard') setShowFigmaImporter(false)
  }, [generationMode])

  useEffect(() => {
    if (readyInterfacePackages.length === 0) {
      if (selectedInterfaceAssetId) setSelectedInterfaceAssetId('')
      return
    }
    if (!readyInterfacePackages.some((row) => row.id === selectedInterfaceAssetId)) {
      setSelectedInterfaceAssetId(readyInterfacePackages[0].id)
    }
  }, [readyInterfacePackages, selectedInterfaceAssetId])

  useEffect(() => {
    if (approvedReusableLogicAssets.length === 0) {
      if (selectedReusableLogicAssetId) setSelectedReusableLogicAssetId('')
      return
    }
    if (!approvedReusableLogicAssets.some((asset) => asset.id === selectedReusableLogicAssetId)) {
      setSelectedReusableLogicAssetId(approvedReusableLogicAssets[0].id)
    }
  }, [approvedReusableLogicAssets, selectedReusableLogicAssetId])


  function handleSelectVariant(index: number) {
    onSelectVariant(index)
    setVariantView('single')
  }
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supplementInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const imageEvidenceCount = useMemo(() => attachments.length + countMessageImages(messages), [attachments.length, messages])
  const slashQuery = getSlashQuery(draft)
  const promptSkills = useMemo(() => (
    slashQuery === null
      ? []
      : PROMPT_SKILLS.filter((skill) => skillMatchesQuery(skill, slashQuery)).slice(0, 8)
  ), [slashQuery])
  const overallUnderstanding = useMemo(() => getOverallUnderstanding({
    messages,
    nodeComplete,
    imageEvidenceCount,
    prototypeHtml,
    performanceSpec,
  }), [imageEvidenceCount, messages, nodeComplete, performanceSpec, prototypeHtml])
  const questionReplies = useMemo(() => {
    if (performancePolishMode) return performanceReplies(blockingQuestion)
    const assistantText = latestAssistantText(messages)
    const visualReplies = visualResourceReplies(assistantText, Boolean(prototypeHtml))
    if (visualReplies.length > 0) return visualReplies
    return performanceReplies(blockingQuestion)
  }, [blockingQuestion, messages, performancePolishMode, prototypeHtml])
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0)
  const showPromptSkills = slashQuery !== null && promptSkills.length > 0
  const lastUserIndex = findLatestUserMessageIndex(messages)
  const canRemoveLastTurn = lastUserIndex !== -1 && !isSending && !isClassifying && !isImportingFigma

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setHighlightedSkillIndex(0)
  }, [slashQuery])

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }

  async function addImageFiles(selectedFiles: File[], fallbackNamePrefix: string) {
    const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length)
    const files = selectedFiles.slice(0, availableSlots)
    if (selectedFiles.length > availableSlots) {
      setError(`一次最多保留 ${MAX_ATTACHMENTS} 张参考图。`)
    }
    if (!files.length) return

    setError(null)
    setIsClassifying(true)
    try {
      for (const file of files) {
        const mediaType = file.type
        if (!isSupportedImageMediaType(mediaType)) {
          setError('只支持上传 png、jpg、webp 或 gif 图片。')
          continue
        }
        if (file.size > MAX_IMAGE_SIZE) {
          setError('单张参考图不能超过 4MB。')
          continue
        }

        const image = await readImageFileAsClipboardAttachment(file, `${fallbackNamePrefix}-${Date.now()}.png`)
        const base64 = image.data
        if (!base64) continue
        const classification = await onClassifyImageAttachment({
          name: image.name,
          mediaType,
          data: base64,
        })

        setAttachments((current) => [
          ...current,
          {
            id: `pending-${Date.now()}-${image.name}-${current.length}`,
            name: image.name,
            role: classification.role,
            reason: classification.reason,
            mediaType,
            data: base64,
            previewUrl: image.previewUrl,
          },
        ])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片识别失败，请重试')
    } finally {
      setIsClassifying(false)
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? [])
    event.target.value = ''
    await addImageFiles(selectedFiles, 'uploaded-image')
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = getClipboardImageFiles(event.clipboardData)
    if (!files.length) return

    event.preventDefault()
    await addImageFiles(files, 'pasted-image')
  }

  async function handleImportFigmaFrame() {
    if (isImportingFigma) return

    const url = figmaUrl.trim()
    if (!url) {
      setError('请粘贴 Figma Frame 链接。')
      return
    }

    setError(null)
    setIsImportingFigma(true)
    setFigmaImportProgress(buildFigmaImportProgress(0))
    const startedAt = Date.now()
    const progressTimer = window.setInterval(() => {
      setFigmaImportProgress(buildFigmaImportProgress(Date.now() - startedAt))
    }, 500)
    try {
      const importGenerationMode: PrototypeGenerationMode = 'draft_preview'
      await onImportFigmaFrame({ url }, { generationMode: importGenerationMode })
      setFigmaImportProgress({
        value: 100,
        status: '草稿预览已生成',
        detail: '正在切换到右侧预览，可作为草稿继续打磨或后续切到资源库标准。',
      })
      setFigmaUrl('')
      setShowFigmaImporter(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入 Figma Frame 失败，请检查链接、环境变量和文件权限。')
    } finally {
      window.clearInterval(progressTimer)
      setIsImportingFigma(false)
      setFigmaImportProgress(null)
    }
  }

  async function handleSupplementFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || isSuggesting || isSending || isClassifying || isImportingFigma) return

    const validFiles = files.filter((file) => {
      if (/\.(md|txt|json|jsonc)$/iu.test(file.name)) return true
      setError('补充节点资料只支持 .md、.txt、.json、.jsonc。')
      return false
    })
    if (!validFiles.length) return

    setError(null)
    setIsSuggesting(true)
    setIsSending(true)
    try {
      const documents = (await Promise.all(validFiles.map(async (file): Promise<DocumentBlock | null> => {
        const text = await readFileAsText(file)
        if (!text) return null
        return buildDocumentAttachment(file.name, text)
      }))).filter((source): source is DocumentBlock => source !== null)

      if (!documents.length) {
        setError('上传资料没有可读取的文本内容。')
        return
      }

      const content = buildMessageContentWithDocuments(draft.trim(), documents)
      setDraft('')
      setAttachments([])
      await onSend(content, { performancePolishMode, generationMode })
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料分析失败，请重试')
    } finally {
      setIsSuggesting(false)
      setIsSending(false)
    }
  }

  function buildMessageContent(text: string): ChatMessage['content'] {
    if (attachments.length === 0) return text

    const fallbackText = text || '请根据这批图片证据补齐文档中的布局层级、控件状态、视觉差异、素材复用和反例约束。'
    const attachmentLines = attachments.map((item, index) => (
      `${index + 1}. ${item.role}（${roleLabel(item.role)}）：${item.name}${item.reason ? `\n   分类理由：${item.reason}` : ''}`
    ))

    return [
      {
        type: 'text',
        text: `${fallbackText}\n\n上传图片：\n${attachmentLines.join('\n')}`,
      },
      ...attachments.map((item) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: item.mediaType,
          data: item.data,
        },
      })),
    ]
  }

  function buildMessageContentWithDocuments(text: string, documents: DocumentBlock[]): ChatMessage['content'] {
    if (documents.length === 0) return buildMessageContent(text)

    const baseContent = buildMessageContent(text)
    const introText = text || 'Please use the uploaded material attachments to continue polishing the current node.'
    const baseBlocks: ContentBlock[] = typeof baseContent === 'string'
      ? [{ type: 'text', text: baseContent || introText }]
      : baseContent

    return [...baseBlocks, ...documents]
  }

  async function handleSend() {
    const text = draft.trim()
    if (isSending || isClassifying || isImportingFigma) return

    if (!text && attachments.length === 0) return

    const content = buildMessageContent(text)
    setDraft('')
    setAttachments([])
    setError(null)
    setIsSending(true)
    try {
      await onSend(content, { performancePolishMode, generationMode })
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请重试')
    } finally {
      setIsSending(false)
    }
  }

  async function handlePerformanceModeChange(nextMode: boolean) {
    if (!nextMode) {
      setPerformancePolishMode(false)
      return
    }

    if (performancePolishMode) return

    setPerformancePolishMode(true)
    if (isSending || isClassifying || isImportingFigma) return

    setError(null)
    setIsSending(true)
    try {
      await onSend('进入 AI 追问表现模式。请根据当前节点、已有文档和表现编排状态，立即提出当前最不清楚、最阻塞实现的一个表现问题。', {
        performancePolishMode: true,
        suppressUserEcho: true,
        generationMode,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换到 AI 追问表现失败，请重试')
    } finally {
      setIsSending(false)
    }
  }

  async function handleGeneratePrototype(instruction?: string, options?: { singlePrototypeOnly?: boolean; recordInstruction?: boolean; evidenceContent?: ChatMessage['content']; currentTurnOnly?: boolean; generationMode?: PrototypeGenerationMode; preferredInterfaceAssetId?: string | null; forceInterfaceBase?: boolean }) {
    try {
      const updated = await onGeneratePrototype(instruction, {
        singlePrototypeOnly: options?.singlePrototypeOnly ?? singlePrototypeOnly,
        recordInstruction: options?.recordInstruction,
        evidenceContent: options?.evidenceContent,
        currentTurnOnly: options?.currentTurnOnly,
        generationMode: options?.generationMode ?? generationMode,
        preferredInterfaceAssetId: options?.preferredInterfaceAssetId,
        forceInterfaceBase: options?.forceInterfaceBase,
      })
      if (!updated) setError('原型更新没有生成新的 HTML，请重试。')
      return updated
    } catch (err) {
      if (isAbortError(err)) return false
      setError(errorMessageFromUnknown(err))
      return false
    }
  }

  async function handleGenerateFromInterfacePackage() {
    if (isSending || isClassifying || isImportingFigma || isGeneratingPrototype) return
    if (!selectedInterfacePackage) {
      setError('请先在资源库导入并解析一个“界面”资源包。')
      return
    }

    const draftInstruction = draft.trim()
    const hasPendingEvidence = Boolean(draftInstruction || attachments.length > 0)
    const pendingEvidenceContent = hasPendingEvidence ? buildMessageContent(draftInstruction) : undefined
    const instruction = [
      `请以资源库界面「${selectedInterfacePackage.name || selectedInterfacePackage.result?.panelName || '未命名界面'}」作为标准底板生成交付版 HTML。`,
      draftInstruction ? `补充要求：${draftInstruction}` : '根据当前节点 PRD 补齐交互状态、数据分支、按钮反馈和异常态。',
    ].join('\n')

    if (hasPendingEvidence) {
      setDraft('')
      setAttachments([])
    }
    setError(null)
    await handleGeneratePrototype(instruction, {
      singlePrototypeOnly,
      recordInstruction: true,
      evidenceContent: pendingEvidenceContent,
      generationMode: 'resource_standard',
      preferredInterfaceAssetId: selectedInterfacePackage.id,
      forceInterfaceBase: true,
    })
  }

  async function handleGenerateFromReusableLogic() {
    if (isSending || isClassifying || isImportingFigma || isGeneratingPrototype) return
    if (!selectedReusableLogicAsset) {
      setError('请先在草稿模式中确认一条可复用表现逻辑。')
      return
    }

    const draftInstruction = draft.trim()
    const hasPendingEvidence = Boolean(draftInstruction || attachments.length > 0)
    const pendingEvidenceContent = hasPendingEvidence ? buildMessageContent(draftInstruction) : undefined
    const instruction = [
      formatReusableLogicAssetForPrompt(selectedReusableLogicAsset),
      draftInstruction ? `当前补充要求：${draftInstruction}` : null,
    ].filter(Boolean).join('\n\n')

    if (hasPendingEvidence) {
      setDraft('')
      setAttachments([])
    }
    setError(null)
    await handleGeneratePrototype(instruction, {
      singlePrototypeOnly,
      recordInstruction: true,
      evidenceContent: pendingEvidenceContent,
      generationMode: 'resource_standard',
      preferredInterfaceAssetId: selectedInterfacePackage?.id ?? null,
      forceInterfaceBase: Boolean(selectedInterfacePackage),
    })
  }

  async function handlePrototypeButtonClick(options: { compareVariants?: boolean } = {}) {
    if (isGeneratingPrototype) {
      onCancelPrototypeGeneration()
      return
    }
    if (isSending || isClassifying || isImportingFigma) return

    const draftInstruction = draft.trim()
    const hasPendingEvidence = Boolean(draftInstruction || attachments.length > 0)
    const pendingEvidenceContent = hasPendingEvidence ? buildMessageContent(draftInstruction) : undefined
    const useSinglePrototype = options.compareVariants ? false : singlePrototypeOnly
    const selectedGenerationMode = generationMode

    if (!prototypeHtml) {
      if (hasPendingEvidence) {
        setDraft('')
        setAttachments([])
        setError(null)
      }
      await handleGeneratePrototype(undefined, { evidenceContent: pendingEvidenceContent, singlePrototypeOnly: useSinglePrototype, generationMode: selectedGenerationMode })
      return
    }

    if (draftInstruction && attachments.length > 0) {
      setDraft('')
      setAttachments([])
      setError(null)
      await handleGeneratePrototype(draftInstruction, { recordInstruction: true, evidenceContent: pendingEvidenceContent, singlePrototypeOnly: useSinglePrototype, generationMode: selectedGenerationMode })
      return
    }

    if (draftInstruction) {
      if (attachments.length > 0) {
        setError('带图片的原型修改请先发送给 AI，让图片证据进入当前节点上下文。')
        return
      }
      setDraft('')
      setError(null)
      await handleGeneratePrototype(draftInstruction, { recordInstruction: true, singlePrototypeOnly: useSinglePrototype, generationMode: selectedGenerationMode })
      return
    }

    if (attachments.length > 0 && pendingEvidenceContent) {
      const imageAlignmentInstruction = '请根据这些图片证据对齐当前原型的布局、层级、间距、颜色、控件位置和文字。'
      setDraft('')
      setAttachments([])
      setError(null)
      await handleGeneratePrototype(imageAlignmentInstruction, { recordInstruction: true, evidenceContent: pendingEvidenceContent, singlePrototypeOnly: useSinglePrototype, generationMode: selectedGenerationMode })
      return
    }

    const instruction = latestUserPrototypeInstruction(messages)
    if (!instruction) {
      setError('请先在对话框里描述要修改的 UI，再点击“按对话更新”。')
      return
    }
    setError(null)
    await handleGeneratePrototype(instruction, { singlePrototypeOnly: useSinglePrototype, generationMode: selectedGenerationMode })
  }

  function handleClearChat() {
    if (isSending) return
    setAttachments([])
    setError(null)
    onClearChat()
  }

  function restoreRecalledMessage(message: ChatMessage) {
    setDraft(stripRecalledAttachmentLines(getTextFromMessage(message.content)))
    setAttachments(recalledImageAttachments(message.content))
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function handleRemoveLastTurn(restoreDraft: boolean) {
    if (!canRemoveLastTurn) return
    const recalledMessage = onRemoveLastTurn()
    if (!recalledMessage) return
    if (restoreDraft) {
      restoreRecalledMessage(recalledMessage)
    } else {
      setDraft('')
      setAttachments([])
    }
    setError(null)
  }

  function insertPromptSkill(skill: PromptSkill) {
    setDraft((current) => {
      const match = /(?:^|\s)\/([^\s/]*)$/u.exec(current)
      if (!match) {
        const prefix = current.trimEnd()
        return prefix ? `${prefix}\n\n${skill.detail}` : skill.detail
      }

      const slashStart = match.index + match[0].lastIndexOf('/')
      const prefix = current.slice(0, slashStart).trimEnd()
      return prefix ? `${prefix}\n\n${skill.detail}` : skill.detail
    })
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function removeSlashQuery() {
    setDraft((current) => {
      const match = /(?:^|\s)\/([^\s/]*)$/u.exec(current)
      if (!match) return current
      const slashStart = match.index + match[0].lastIndexOf('/')
      return current.slice(0, slashStart).trimEnd()
    })
  }

  function insertQuestionReply(reply: QuestionReply) {
    setDraft((current) => {
      const prefix = current.trimEnd()
      return prefix ? `${prefix}\n${reply.text}` : reply.text
    })
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showPromptSkills) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedSkillIndex((current) => (current + 1) % promptSkills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedSkillIndex((current) => (current - 1 + promptSkills.length) % promptSkills.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertPromptSkill(promptSkills[highlightedSkillIndex] ?? promptSkills[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        removeSlashQuery()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const canSubmitDraft = Boolean(draft.trim() || attachments.length > 0)
  const composePlaceholder = performancePolishMode
    ? '回答当前表现问题。也可以补充触发、分支、顺序、资源、层级、控制或结束状态...'
    : '自由描述你想补充或修改的内容，可同时要求打磨文档、更新原型或分析参考图...'
  const understandingTone = overallUnderstanding.score >= 80
    ? 'bg-tertiary'
    : overallUnderstanding.score >= 60
      ? 'bg-secondary'
      : 'bg-error'
  const modeTitle = performancePolishMode ? 'AI 追问表现' : '自由迭代'
  const modeSubtitle = performancePolishMode
    ? '单问单答 · 回答后重算理解度'
    : '自由补充 · AI 自动归类处理'
  const focusValue = performancePolishMode && blockingQuestion
    ? performanceSlotLabel(blockingQuestion.slot)
    : performancePolishMode
      ? '等待下一问'
      : '未启用'
  const assetAuditText = assetAuditErrorCount > 0
    ? `审计错误 ${assetAuditErrorCount}`
    : assetAuditWarningCount > 0
      ? `审计提示 ${assetAuditWarningCount}`
      : null
  const prototypeCancelText = isCancellingPrototype ? '取消中' : '取消生成'
  const prototypePrimaryText = isGeneratingPrototype ? prototypeCancelText : prototypeHtml ? '按对话更新' : '生成原型'
  const prototypeCompareText = isGeneratingPrototype ? prototypeCancelText : '双方案'
  const prototypePrimaryIcon = isCancellingPrototype ? 'hourglass_empty' : isGeneratingPrototype ? 'stop_circle' : 'auto_awesome'
  const prototypeCompareIcon = isCancellingPrototype ? 'hourglass_empty' : isGeneratingPrototype ? 'stop_circle' : 'view_comfy'
  const prototypeActionDisabled = (isImportingFigma && !isGeneratingPrototype) || isCancellingPrototype
  const figmaImportActionText = '生成草稿'
  const figmaImporterTitle = '从 Figma 提取视觉证据，并结合当前文档生成草稿预览'

  return (
    <div className="flex min-w-0 flex-1 bg-background blueprint-grid">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-outline-variant/30 bg-surface/90 px-md py-xs backdrop-blur-sm">
          <div className="flex min-h-[42px] flex-wrap items-center gap-xs">
            <div className="flex h-8 shrink-0 overflow-hidden rounded-md border border-outline-variant/50 bg-surface-container-low p-[2px]">
              <button
                type="button"
                onClick={() => { void handlePerformanceModeChange(false) }}
                aria-pressed={!performancePolishMode}
                className={[
                  'flex items-center gap-xs rounded px-sm text-label-md transition-colors',
                  !performancePolishMode
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                ].join(' ')}
                title="自由迭代"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>edit_note</span>
                自由迭代
              </button>
              <button
                type="button"
                onClick={() => { void handlePerformanceModeChange(true) }}
                disabled={isSending || isClassifying || isImportingFigma}
                aria-pressed={performancePolishMode}
                className={[
                  'flex items-center gap-xs rounded px-sm text-label-md transition-colors disabled:cursor-wait disabled:opacity-60',
                  performancePolishMode
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                ].join(' ')}
                title="AI 追问表现"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>question_answer</span>
                AI 追问
              </button>
            </div>

            <div className="mx-xs hidden h-5 w-px bg-outline-variant/50 sm:block" />

            <div className="flex min-w-[180px] flex-1 items-center gap-xs overflow-hidden">
              <span className={[
                'material-symbols-outlined shrink-0',
                performancePolishMode ? 'text-secondary' : 'text-primary',
              ].join(' ')} style={{ fontSize: '17px' }}>
                {performancePolishMode ? 'psychology_alt' : 'tune'}
              </span>
              <div className="min-w-0 truncate">
                <span className="text-label-md text-on-surface">{modeTitle}</span>
                <span className="mx-xs text-on-surface-variant/50">/</span>
                <span className="text-label-md text-on-surface-variant">{modeSubtitle}</span>
                <span className="mx-xs text-on-surface-variant/50">/</span>
                <span className="font-mono text-[10px] text-secondary">焦点: {focusValue}</span>
              </div>
            </div>

            <div className="flex h-8 min-w-[168px] items-center gap-xs rounded-md border border-outline-variant/40 bg-surface-container-low px-xs" title={overallUnderstanding.detail}>
              <span className="font-mono text-[10px] text-on-surface-variant">理解度</span>
              <div className="h-1.5 min-w-[58px] flex-1 overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${understandingTone}`}
                  style={{ width: `${overallUnderstanding.score}%` }}
                />
              </div>
              <span className="font-mono text-[11px] text-on-surface">{overallUnderstanding.score}%</span>
              <span className="hidden font-mono text-[10px] text-on-surface-variant 2xl:inline">
                {overallUnderstanding.confirmedCount}/{overallUnderstanding.unresolvedCount}
              </span>
            </div>

            <button
              type="button"
              onClick={handleClearChat}
              disabled={isSending || messages.length === 0}
              aria-label="清空当前节点聊天和参考图"
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-outline-variant/45 bg-surface text-on-surface-variant transition-colors hover:border-error/70 hover:bg-error-container/20 hover:text-error disabled:opacity-40"
              title="清空当前节点聊天和参考图"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>delete</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              canRemove={i === lastUserIndex && canRemoveLastTurn}
              onRecall={() => handleRemoveLastTurn(true)}
              onClear={() => handleRemoveLastTurn(false)}
            />
          ))}
          {isSending && <LoadingIndicator />}
          {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
          <div ref={messagesEndRef} />
        </div>

        <div className="shrink-0 border-t border-outline-variant bg-surface px-lg py-md">
          {nodeOperationSuggestions.length > 0 ? (
            <div className="mb-sm">
              <NodeOperationReview
                suggestions={nodeOperationSuggestions}
                onApply={onApplyNodeOperationSuggestion}
                onDismiss={onDismissNodeOperationSuggestion}
              />
            </div>
          ) : null}

          {showFigmaImporter ? (
            <div className="mb-sm rounded-lg border border-primary/30 bg-primary/10 p-sm">
              <div className="mb-xs flex items-center justify-between gap-sm">
                <div className="flex items-center gap-xs text-label-md font-medium text-primary">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>design_services</span>
                  Figma Frame
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowFigmaImporter(false)
                  }}
                  className="rounded px-xs text-label-md text-on-surface-variant hover:bg-surface-container-high"
                  title="关闭"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-1 gap-xs xl:grid-cols-[1fr_auto]">
                <input
                  value={figmaUrl}
                  onChange={(event) => setFigmaUrl(event.target.value)}
                  placeholder="粘贴 Figma Frame 链接"
                  className="min-h-[36px] min-w-0 rounded-md border border-outline-variant bg-surface px-sm text-body-sm text-on-surface outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleImportFigmaFrame()}
                  disabled={isImportingFigma}
                  className="flex min-h-[36px] items-center gap-xs rounded-md border border-primary bg-primary px-sm text-label-md font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
                  title={figmaImporterTitle}
                >
                  <span className={['material-symbols-outlined', isImportingFigma ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {isImportingFigma ? 'sync' : 'download'}
                  </span>
                  {figmaImportActionText}
                </button>
              </div>
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="mb-sm flex gap-xs overflow-x-auto rounded-lg border border-secondary/30 bg-secondary/10 p-xs">
              {attachments.map((item) => (
                <div key={item.id} className="flex w-[172px] shrink-0 items-center gap-xs rounded bg-surface-container p-xs">
                  <img src={item.previewUrl} alt={item.name} className="h-12 w-12 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className={`inline-flex max-w-full rounded border px-xs py-[1px] font-mono text-[10px] ${roleTone(item.role)}`}>
                      <span className="truncate">{roleLabel(item.role)}</span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-on-surface-variant" title={item.reason}>{item.name}</div>
                  </div>
                  <button
                    onClick={() => removeAttachment(item.id)}
                    className="rounded px-xs font-mono text-code-sm text-on-surface-variant hover:bg-surface-container-high hover:text-error"
                    title="移除图片"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-sm">
            {showPromptSkills ? (
              <div className="rounded-lg border border-secondary/40 bg-surface-container-high p-xs shadow-sm">
                <div className="grid max-h-44 grid-cols-2 gap-xs overflow-y-auto">
                  {promptSkills.map((skill, index) => (
                    <button
                      key={skill.id}
                      type="button"
                      onMouseEnter={() => setHighlightedSkillIndex(index)}
                      onClick={() => insertPromptSkill(skill)}
                      className={[
                        'flex min-h-[44px] min-w-0 items-center gap-xs rounded-md border px-sm py-xs text-left transition-colors',
                        index === highlightedSkillIndex
                          ? 'border-secondary bg-secondary-container text-on-secondary-container'
                          : 'border-outline-variant/50 bg-surface text-on-surface-variant hover:border-secondary hover:text-on-surface',
                      ].join(' ')}
                    >
                      <span className="material-symbols-outlined shrink-0" style={{ fontSize: '16px' }}>bolt</span>
                      <span className="min-w-0">
                        <span className="block truncate text-label-md">/{skill.label}</span>
                        <span className="block truncate font-mono text-[10px]">{skill.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!showPromptSkills && questionReplies.length > 0 && !isSending ? (
              <div className="flex flex-wrap gap-xs">
                {questionReplies.map((reply) => (
                  <button
                    key={`${reply.label}-${reply.text}`}
                    type="button"
                    onClick={() => insertQuestionReply(reply)}
                    className="rounded-lg border border-secondary/40 bg-secondary/10 px-sm py-xs text-label-md text-secondary transition-colors hover:bg-secondary/20 active:scale-[0.99]"
                    title="点击预填此回答"
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(event) => { void handlePaste(event) }}
              onKeyDown={handleKeyDown}
              placeholder={composePlaceholder}
              disabled={isSending}
              rows={3}
              className="w-full resize-none rounded-lg border border-outline-variant bg-surface-container px-md py-sm text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-secondary focus:outline-none disabled:opacity-50 transition-colors"
            />

            <div className="flex items-center justify-end gap-md">
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-sm">
                <input
                  ref={supplementInputRef}
                  type="file"
                  accept=".md,.txt,.json,application/json,text/markdown,text/plain"
                  multiple
                  className="hidden"
                  onChange={handleSupplementFileChange}
                />
                <button
                  onClick={() => supplementInputRef.current?.click()}
                  disabled={isSuggesting || isSending || isClassifying || isImportingFigma}
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-sm text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                  title="上传补充资料"
                >
                  <span className={['material-symbols-outlined', isSuggesting ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {isSuggesting ? 'sync' : 'attach_file'}
                  </span>
                  资料
                </button>
                {generationMode === 'resource_standard' ? (
                  <div className="flex min-h-[36px] min-w-0 items-center gap-xs rounded-lg border border-tertiary/40 bg-tertiary/10 px-xs">
                    <span className="material-symbols-outlined shrink-0 text-tertiary" style={{ fontSize: '16px' }}>inventory_2</span>
                    <select
                      value={selectedInterfacePackage?.id ?? ''}
                      onChange={(event) => setSelectedInterfaceAssetId(event.target.value)}
                      disabled={readyInterfacePackages.length === 0 || isGeneratingPrototype}
                      className="h-7 min-w-[124px] max-w-[190px] rounded-md border border-tertiary/30 bg-surface px-xs text-label-md text-on-surface outline-none disabled:opacity-50"
                      title={selectedInterfacePackage ? interfacePackageLabel(selectedInterfacePackage) : '暂无可用界面资源包'}
                    >
                      {readyInterfacePackages.length === 0 ? (
                        <option value="">暂无界面包</option>
                      ) : readyInterfacePackages.map((row) => (
                        <option key={row.id} value={row.id}>{interfacePackageLabel(row)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleGenerateFromInterfacePackage()}
                      disabled={!selectedInterfacePackage || isGeneratingPrototype || isClassifying || isImportingFigma}
                      className="flex h-7 shrink-0 items-center gap-[2px] rounded-md border border-tertiary bg-tertiary-container px-sm text-label-md font-medium text-on-tertiary-container transition-opacity hover:opacity-90 disabled:opacity-40"
                      title={selectedInterfacePackage ? '以选中的界面资源包为底板生成资源库标准 HTML' : '请先在资源库导入并解析界面资源包'}
                    >
                      <span className={['material-symbols-outlined', isGeneratingPrototype ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '14px' }}>
                        {isGeneratingPrototype ? 'sync' : 'play_arrow'}
                      </span>
                      用界面生成
                    </button>
                    <span className="h-5 w-px bg-tertiary/30" />
                    <select
                      value={selectedReusableLogicAsset?.id ?? ''}
                      onChange={(event) => setSelectedReusableLogicAssetId(event.target.value)}
                      disabled={approvedReusableLogicAssets.length === 0 || isGeneratingPrototype}
                      className="h-7 min-w-[124px] max-w-[190px] rounded-md border border-tertiary/30 bg-surface px-xs text-label-md text-on-surface outline-none disabled:opacity-50"
                      title={selectedReusableLogicAsset ? `${reusableLogicTypeLabel(selectedReusableLogicAsset.type)} / ${selectedReusableLogicAsset.name}` : '暂无已入库表现逻辑'}
                    >
                      {approvedReusableLogicAssets.length === 0 ? (
                        <option value="">暂无表现逻辑</option>
                      ) : approvedReusableLogicAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleGenerateFromReusableLogic()}
                      disabled={!selectedReusableLogicAsset || isGeneratingPrototype || isClassifying || isImportingFigma}
                      className="flex h-7 shrink-0 items-center gap-[2px] rounded-md border border-secondary bg-secondary-container px-sm text-label-md font-medium text-on-secondary-container transition-opacity hover:opacity-90 disabled:opacity-40"
                      title={selectedReusableLogicAsset ? '按选中的表现逻辑生成资源库标准 HTML' : '请先从草稿模式沉淀并确认表现逻辑'}
                    >
                      <span className={['material-symbols-outlined', isGeneratingPrototype ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '14px' }}>
                        {isGeneratingPrototype ? 'sync' : 'schema'}
                      </span>
                      用逻辑生成
                    </button>
                    {readyInterfacePackages.length === 0 && onOpenAssets ? (
                      <button
                        type="button"
                        onClick={onOpenAssets}
                        className="flex h-7 shrink-0 items-center rounded-md px-xs text-label-md text-tertiary hover:bg-tertiary/10"
                        title="打开资源库导入界面包"
                      >
                        导入
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowFigmaImporter((current) => !current)}
                    disabled={isImportingFigma}
                    className="flex min-h-[36px] items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-sm text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                    title="把 Figma 链接作为输入来源"
                  >
                    <span className={['material-symbols-outlined', isImportingFigma ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                      {isImportingFigma ? 'sync' : 'design_services'}
                    </span>
                    Figma
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(event) => void handleFileChange(event)}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isClassifying || attachments.length >= MAX_ATTACHMENTS}
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-sm text-label-md text-on-surface-variant transition-colors hover:border-secondary hover:text-secondary disabled:opacity-40"
                  title="上传图片"
                >
                  <span className={['material-symbols-outlined', isClassifying ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {isClassifying ? 'sync' : 'add_photo_alternate'}
                  </span>
                  图片
                </button>

                <button
                  onClick={() => void handleSend()}
                  disabled={!canSubmitDraft || isSending || isClassifying || isImportingFigma}
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-secondary bg-secondary-container px-md py-sm text-label-md font-medium text-on-secondary-container transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
                  {performancePolishMode ? '回答当前问题' : '发送给 AI'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className="flex min-w-[520px] flex-[1.35] shrink-0 flex-col border-l border-outline-variant bg-surface-container">
        <div className="border-b border-outline-variant px-md py-sm">
          <div className="mb-sm flex items-center justify-between gap-sm">
            <div className="flex items-center gap-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">view_carousel</span>
              <h2 className="text-headline-sm font-semibold">视觉舱</h2>
            </div>
            <div className="flex shrink-0 items-center gap-xs">
              <button
                onClick={() => void handlePrototypeButtonClick()}
                disabled={prototypeActionDisabled}
                className={[
                  'flex items-center gap-xs rounded-lg border px-sm py-xs font-mono text-[11px] uppercase transition-colors disabled:opacity-40',
                  isGeneratingPrototype
                    ? 'border-error/50 bg-error/10 text-error hover:bg-error/20'
                    : 'border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20',
                ].join(' ')}
                title={isGeneratingPrototype ? '取消当前原型生成请求' : prototypeHtml ? '使用最近的对话或当前输入框内容增量修改已有原型' : '根据当前节点生成首版 HTML 原型'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  {prototypePrimaryIcon}
                </span>
                {prototypePrimaryText}
              </button>
              <button
                onClick={() => void handlePrototypeButtonClick({ compareVariants: true })}
                disabled={prototypeActionDisabled}
                className={[
                  'flex items-center gap-xs rounded-lg border px-sm py-xs font-mono text-[11px] uppercase transition-colors disabled:opacity-40',
                  isGeneratingPrototype
                    ? 'border-error/50 bg-error/10 text-error hover:bg-error/20'
                    : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
                ].join(' ')}
                title={isGeneratingPrototype ? '取消当前原型生成请求' : '并行生成两个候选方案，用于对比后选择一个继续打磨'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  {prototypeCompareIcon}
                </span>
                {prototypeCompareText}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-xs">
            <div className="inline-flex min-h-[34px] overflow-hidden rounded-md border border-outline-variant/45 bg-surface-container-low p-[2px]">
              {GENERATION_MODE_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onGenerationModeChange(item.id)}
                  aria-pressed={generationMode === item.id}
                  className={[
                    'flex items-center gap-xs rounded px-sm text-label-md transition-colors',
                    generationMode === item.id
                      ? item.id === 'resource_standard'
                        ? 'bg-tertiary-container text-on-tertiary-container'
                        : 'bg-secondary-container text-on-secondary-container'
                      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                  ].join(' ')}
                  title={item.title}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-end gap-xs">
              {assetAuditText ? (
                <span
                  className={[
                    'inline-flex min-h-[28px] items-center gap-xs rounded-md border px-sm font-mono text-[10px] uppercase',
                    assetAuditErrorCount > 0
                      ? 'border-error/50 bg-error/10 text-error'
                      : 'border-secondary/50 bg-secondary/10 text-secondary',
                  ].join(' ')}
                  title="当前原型素材引用审计"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                    {assetAuditErrorCount > 0 ? 'report' : 'policy'}
                  </span>
                  {assetAuditText}
                </span>
              ) : null}
              {onOpenAssets ? (
                <button
                  type="button"
                  onClick={onOpenAssets}
                  className="inline-flex min-h-[28px] items-center gap-xs rounded-md border border-outline-variant/45 bg-surface-container-low px-sm text-label-md text-on-surface-variant transition-colors hover:border-tertiary/50 hover:text-tertiary"
                  title="打开资源库"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>folder_open</span>
                  资源库
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-sm">
            {isImportingFigma && figmaImportProgress ? (
              <FigmaImportProgressPanel progress={figmaImportProgress} sourceUrl={figmaUrl} />
            ) : null}
            {hasMultipleVariants && variantView === 'grid' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-zinc-950">
                <div className="flex items-center justify-between border-b border-outline-variant/20 bg-zinc-900/80 px-sm py-xs">
                  <span className="font-mono text-code-sm text-on-surface-variant">
                    {prototypeVariants.length} 个候选方案 · 选择一个继续打磨
                  </span>
                  <span className="font-mono text-[10px] uppercase text-on-surface-variant">Alt+1~{prototypeVariants.length} 快速切换</span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <PrototypeVariants
                    variants={prototypeVariants}
                    selectedIndex={selectedVariantIndex}
                    onSelect={handleSelectVariant}
                  />
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {hasMultipleVariants ? (
                  <button
                    onClick={() => setVariantView('grid')}
                    className="mb-sm flex items-center gap-xs self-start rounded-md border border-outline-variant/30 bg-surface-container px-sm py-xs font-mono text-[11px] text-on-surface-variant transition-colors hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>grid_view</span>
                    全部方案（{prototypeVariants.length}）
                  </button>
                ) : null}
                <PrototypeBoard
                  html={selectedPrototypeHtml}
                  history={prototypeHistory}
                  isLoading={isGeneratingPrototype}
                  singlePrototypeOnly={singlePrototypeOnly}
                  onSinglePrototypeOnlyChange={setSinglePrototypeOnly}
                  onRestore={onRestorePrototype}
                  onClearHistory={onClearPrototypeHistory}
                  canClearHistory={prototypeHistory.length > 0 || Boolean(selectedPrototypeHtml)}
                  assetAudit={selectedPrototypeVariant?.assetAudit}
                />
              </div>
            )}
          </div>
      </aside>
    </div>
  )
}
