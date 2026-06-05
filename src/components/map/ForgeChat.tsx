import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PrototypeVersion } from '../../store/appStore'
import type {
  ChatMessage,
  ContentBlock,
  ImageBlock,
  ReferenceImageClassificationRequest,
  ReferenceImageClassificationResponse,
  ReferenceImageRole,
} from '../../types/chat'
import type { PrototypeVariant } from '../../types/prototypeVariant'
import type { PrdNodeOperationSuggestion } from '../../types/prdNode'
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
  nodeOperationSuggestions: PrdNodeOperationSuggestion[]
  onSend: (content: ChatMessage['content']) => void | Promise<void>
  onSuggestNodeOperations: (input: { supplementText: string; sources: SupplementSource[] }) => void | Promise<void>
  onClassifyImageAttachment: (input: ReferenceImageClassificationRequest) => Promise<ReferenceImageClassificationResponse>
  onApplyNodeOperationSuggestion: (suggestionId: string) => void
  onDismissNodeOperationSuggestion: (suggestionId: string) => void
  onGeneratePrototype: (instruction?: string, options?: { singlePrototypeOnly?: boolean; recordInstruction?: boolean }) => void | Promise<void>
  onRestorePrototype: (id: string) => void
  onClearPrototypeHistory: () => void
  onSelectVariant: (index: number) => void
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

interface SupplementSource {
  id: string
  name: string
  sourceKind: 'upload'
  text: string
}

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
      return <code key={index} className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
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
      <p key={`p-${blocks.length}`} className="leading-relaxed">
        {renderInlineMarkdown(paragraph.join(' '))}
      </p>,
    )
    paragraph = []
  }

  function flushList() {
    if (!list.length) return
    const Tag = orderedList ? 'ol' : 'ul'
    blocks.push(
      <Tag key={`list-${blocks.length}`} className={`space-y-1 pl-md leading-relaxed ${orderedList ? 'list-decimal' : 'list-disc'}`}>
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
          <pre key={`code-${blocks.length}`} className="overflow-x-auto rounded-lg bg-zinc-950 p-sm font-mono text-[11px] leading-relaxed text-zinc-100">
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
        <div key={`h-${blocks.length}`} className={`${className} font-semibold text-on-surface`}>
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
      <pre key={`code-${blocks.length}`} className="overflow-x-auto rounded-lg bg-zinc-950 p-sm font-mono text-[11px] leading-relaxed text-zinc-100">
        <code>{trailingCodeLines.join('\n')}</code>
      </pre>,
    )
  }

  return <div className="flex flex-col gap-xs whitespace-normal">{blocks}</div>
}

function renderMessageContent(content: ChatMessage['content']) {
  if (typeof content === 'string') return renderMarkdownText(content)

  const textBlocks = content.filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
  const imageBlocks = content.filter((b): b is ImageBlock => b.type === 'image')

  return (
    <div className="flex flex-col gap-sm">
      {textBlocks.map((block, index) => (
        <div key={`text-${index}`}>{renderMarkdownText(block.text)}</div>
      ))}
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

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="max-w-[78%] self-end rounded-2xl rounded-tr-sm bg-secondary-container px-md py-sm text-body-md text-on-secondary-container">
        {renderMessageContent(msg.content)}
      </div>
    )
  }

  return (
    <div className="max-w-[84%] self-start rounded-2xl rounded-tl-sm bg-surface-container px-md py-sm text-body-md text-on-surface animate-fade-in">
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
    <div className="flex items-center justify-between gap-sm rounded-lg bg-error-container px-md py-sm text-body-md text-on-error-container">
      <span>{error}</span>
      <button onClick={onDismiss} className="shrink-0 font-bold text-on-error-container hover:opacity-80">
        ×
      </button>
    </div>
  )
}

function countMessageImages(messages: ChatMessage[]) {
  return messages.reduce((count, message) => {
    if (typeof message.content === 'string') return count
    return count + message.content.filter((block) => block.type === 'image').length
  }, 0)
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(String(event.target?.result ?? '').trim())
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败。`))
    reader.readAsText(file)
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(String(event.target?.result ?? ''))
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败。`))
    reader.readAsDataURL(file)
  })
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
  nodeOperationSuggestions,
  onSend,
  onSuggestNodeOperations,
  onClassifyImageAttachment,
  onApplyNodeOperationSuggestion,
  onDismissNodeOperationSuggestion,
  onGeneratePrototype,
  onRestorePrototype,
  onClearPrototypeHistory,
  onSelectVariant,
  onClearChat,
}: ForgeChatProps) {
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [isClassifying, setIsClassifying] = useState(false)
  const [variantView, setVariantView] = useState<'grid' | 'single'>('single')
  const [singlePrototypeOnly, setSinglePrototypeOnly] = useState(false)

  const hasMultipleVariants = prototypeVariants.length > 1
  const selectedPrototypeHtml = prototypeVariants.find((variant) => variant.index === selectedVariantIndex)?.html ?? prototypeHtml

  // Whenever a fresh batch of variants arrives, default back to the comparison grid so the
  // user can choose; collapse to single preview when there is at most one variant.
  useEffect(() => {
    setVariantView(prototypeVariants.length > 1 ? 'grid' : 'single')
  }, [prototypeVariants])


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
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0)
  const showPromptSkills = slashQuery !== null && promptSkills.length > 0

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setHighlightedSkillIndex(0)
  }, [slashQuery])

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length)
    const selectedFiles = Array.from(event.target.files ?? [])
    const files = selectedFiles.slice(0, availableSlots)
    event.target.value = ''
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

        const dataUrl = await readFileAsDataUrl(file)
        const base64 = dataUrl.split(',')[1]
        if (!base64) continue
        const classification = await onClassifyImageAttachment({
          name: file.name,
          mediaType,
          data: base64,
        })

        setAttachments((current) => [
          ...current,
          {
            id: `pending-${Date.now()}-${file.name}-${current.length}`,
            name: file.name,
            role: classification.role,
            reason: classification.reason,
            mediaType,
            data: base64,
            previewUrl: dataUrl,
          },
        ])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片识别失败，请重试')
    } finally {
      setIsClassifying(false)
    }
  }

  async function handleSupplementFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || isSuggesting) return

    const validFiles = files.filter((file) => {
      if (/\.(md|txt|json)$/iu.test(file.name)) return true
      setError('补充节点资料只支持 .md、.txt、.json。')
      return false
    })
    if (!validFiles.length) return

    setError(null)
    setIsSuggesting(true)
    try {
      const sources = (await Promise.all(validFiles.map(async (file, index): Promise<SupplementSource | null> => {
        const text = await readFileAsText(file)
        if (!text) return null
        return { id: `supplement-${Date.now()}-${file.name}-${index}`, name: file.name, sourceKind: 'upload', text }
      }))).filter((source): source is SupplementSource => source !== null)

      if (!sources.length) {
        setError('上传资料没有可读取的文本内容。')
        return
      }

      await onSuggestNodeOperations({ supplementText: '', sources })
    } catch (err) {
      setError(err instanceof Error ? err.message : '资料分析失败，请重试')
    } finally {
      setIsSuggesting(false)
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

  async function handleSend() {
    const text = draft.trim()
    if (isSending || isClassifying) return

    if (!text && attachments.length === 0) return

    const content = buildMessageContent(text)
    setDraft('')
    setAttachments([])
    setError(null)
    setIsSending(true)
    try {
      await onSend(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请重试')
    } finally {
      setIsSending(false)
    }
  }

  async function handleGeneratePrototype(instruction?: string, options?: { recordInstruction?: boolean }) {
    await onGeneratePrototype(instruction, {
      singlePrototypeOnly: !instruction && singlePrototypeOnly,
      recordInstruction: options?.recordInstruction,
    })
  }

  function handleClearChat() {
    if (isSending) return
    setAttachments([])
    setError(null)
    onClearChat()
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
  const composePlaceholder = '输入你想补充/修改的内容，可同时要求打磨文档、更新原型或分析参考图...'

  return (
    <div className="flex min-w-0 flex-1 bg-background blueprint-grid">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-outline-variant/30 bg-surface/80 px-lg py-sm">
          <div className="flex flex-wrap items-center gap-sm">
            {[
              { label: '来源/边界', done: messages.length > 1 },
              { label: '质量门槛', done: nodeComplete },
              { label: '参考证据', done: imageEvidenceCount > 0 },
              { label: '原型预览', done: Boolean(prototypeHtml) },
            ].map((item) => (
              <span
                key={item.label}
                className={[
                  'rounded-full border px-sm py-xs font-mono text-[10px] uppercase',
                  item.done
                    ? 'border-tertiary/40 bg-tertiary-container/20 text-tertiary'
                    : 'border-outline-variant/40 bg-surface-container text-on-surface-variant',
                ].join(' ')}
              >
                {item.done ? '✓' : '○'} {item.label}
              </span>
            ))}
            <button
              onClick={handleClearChat}
              disabled={isSending || messages.length === 0}
              className="ml-auto flex min-h-[30px] items-center gap-xs rounded-lg border border-outline-variant bg-surface px-sm py-xs font-mono text-[11px] text-on-surface-variant transition-colors hover:border-error hover:text-error disabled:opacity-40"
              title="清空当前节点聊天和参考图"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
              清空聊天
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md">
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
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

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
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
                  disabled={isSuggesting}
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-sm text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                  title="上传补充资料"
                >
                  <span className={['material-symbols-outlined', isSuggesting ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {isSuggesting ? 'sync' : 'attach_file'}
                  </span>
                  资料
                </button>
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
                  disabled={!canSubmitDraft || isSending || isClassifying}
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-secondary bg-secondary-container px-md py-sm text-label-md font-medium text-on-secondary-container transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
                  发送给 AI
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
            <button
              onClick={() => void handleGeneratePrototype()}
              disabled={isGeneratingPrototype}
              className="flex items-center gap-xs rounded-lg border border-secondary/40 bg-secondary/10 px-sm py-xs font-mono text-[11px] uppercase text-secondary transition-colors hover:bg-secondary/20 disabled:opacity-40"
            >
              <span className={['material-symbols-outlined', isGeneratingPrototype ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '15px' }}>
                {isGeneratingPrototype ? 'sync' : 'auto_awesome'}
              </span>
              {prototypeHtml ? '更新原型' : '生成原型'}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-sm">
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
                />
              </div>
            )}
          </div>
      </aside>
    </div>
  )
}
