import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PrototypeVersion } from '../../store/appStore'
import type { ChatMessage, ContentBlock, ImageBlock } from '../../types/chat'
import type { PrototypeVariant } from '../../types/prototypeVariant'
import type { PrdNodeOperationSuggestion } from '../../types/prdNode'
import { NodeOperationReview } from './NodeOperationReview'
import { PrototypeBoard } from '../state/PrototypeBoard'
import { PrototypePreviewSurface } from '../state/PrototypeSandboxPreview'
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
  onApplyNodeOperationSuggestion: (suggestionId: string) => void
  onDismissNodeOperationSuggestion: (suggestionId: string) => void
  onConfirm: () => void
  onBack: () => void
  onGeneratePrototype: (instruction?: string, options?: { singlePrototypeOnly?: boolean }) => void | Promise<void>
  onRestorePrototype: (id: string) => void
  onClearPrototypeHistory: () => void
  onSelectVariant: (index: number) => void
  onClearChat: () => void
}

type ReferenceRole = 'reference' | 'asset' | 'state' | 'anti'
type VisualTab = 'references' | 'prototype' | 'compare'

interface ImageAttachment {
  id: string
  name: string
  role: ReferenceRole
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

interface VisualImage {
  id: string
  name: string
  role: ReferenceRole
  mediaType: ImageBlock['source']['media_type']
  data: string
  previewUrl: string
  source: 'pending' | 'sent'
}

const QUICK_PROMPTS = [
  '补齐原文位置、职责边界、依赖字段和需澄清点。',
  '把这篇文档整理成后续 AI 可直接执行的任务上下文。',
  '列出可独立测试的验收项和质量门槛。',
]
const MAX_ATTACHMENTS = 6
const MAX_IMAGE_SIZE = 4 * 1024 * 1024

const VISUAL_TABS: Array<{ id: VisualTab; label: string; icon: string }> = [
  { id: 'prototype', label: '原型', icon: 'phone_iphone' },
  { id: 'references', label: '参考图', icon: 'image_search' },
  { id: 'compare', label: '对比', icon: 'compare' },
]

function roleLabel(role: ReferenceRole) {
  if (role === 'asset') return '素材复用'
  if (role === 'state') return '状态截图'
  if (role === 'anti') return '反例参考'
  return '布局参考'
}

function roleTone(role: ReferenceRole) {
  if (role === 'asset') return 'border-tertiary/40 bg-tertiary-container/20 text-tertiary'
  if (role === 'state') return 'border-secondary/40 bg-secondary/10 text-secondary'
  if (role === 'anti') return 'border-error/40 bg-error/10 text-error'
  return 'border-primary/40 bg-primary/10 text-primary'
}

function detectRoleFromText(text: string): ReferenceRole {
  if (/素材|复用|asset/iu.test(text)) return 'asset'
  if (/状态|冷却|pressed|disabled|loading|截图/iu.test(text)) return 'state'
  if (/反例|避免|不要|anti/iu.test(text)) return 'anti'
  return 'reference'
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

function extractSentImages(messages: ChatMessage[]): VisualImage[] {
  const images: VisualImage[] = []
  messages.forEach((message, messageIndex) => {
    if (typeof message.content === 'string') return
    const text = message.content
      .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    const role = detectRoleFromText(text)
    message.content
      .filter((block): block is ImageBlock => block.type === 'image')
      .forEach((block, imageIndex) => {
        images.push({
          id: `sent-${messageIndex}-${imageIndex}`,
          name: `${roleLabel(role)} ${images.length + 1}`,
          role,
          mediaType: block.source.media_type,
          data: block.source.data,
          previewUrl: `data:${block.source.media_type};base64,${block.source.data}`,
          source: 'sent',
        })
      })
  })
  return images
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
  onApplyNodeOperationSuggestion,
  onDismissNodeOperationSuggestion,
  onConfirm,
  onBack,
  onGeneratePrototype,
  onRestorePrototype,
  onClearPrototypeHistory,
  onSelectVariant,
  onClearChat,
}: ForgeChatProps) {
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [referenceRole, setReferenceRole] = useState<ReferenceRole>('reference')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [supplementSources, setSupplementSources] = useState<SupplementSource[]>([])
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [visualTab, setVisualTab] = useState<VisualTab>('prototype')
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
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supplementInputRef = useRef<HTMLInputElement>(null)

  const sentImages = useMemo(() => extractSentImages(messages), [messages])
  const visualImages = useMemo<VisualImage[]>(() => [
    ...attachments.map((item) => ({ ...item, source: 'pending' as const })),
    ...sentImages,
  ], [attachments, sentImages])
  const selectedImage = visualImages.find((item) => item.id === selectedImageId) ?? visualImages[0] ?? null

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!selectedImageId && visualImages.length > 0) setSelectedImageId(visualImages[0].id)
    if (selectedImageId && !visualImages.some((item) => item.id === selectedImageId)) {
      setSelectedImageId(visualImages[0]?.id ?? null)
    }
  }, [selectedImageId, visualImages])

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length)
    const selectedFiles = Array.from(event.target.files ?? [])
    const files = selectedFiles.slice(0, availableSlots)
    if (selectedFiles.length > availableSlots) {
      setError(`一次最多保留 ${MAX_ATTACHMENTS} 张参考图。`)
    }
    if (!files.length) return

    files.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        setError('只支持上传图片作为打磨参考。')
        return
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setError('单张参考图不能超过 4MB。')
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = String(e.target?.result ?? '')
        const base64 = dataUrl.split(',')[1]
        if (!base64) return
        setAttachments((current) => [
          ...current,
          {
            id: `pending-${Date.now()}-${file.name}-${current.length}`,
            name: file.name,
            role: referenceRole,
            mediaType: file.type as ImageBlock['source']['media_type'],
            data: base64,
            previewUrl: dataUrl,
          },
        ])
        setVisualTab('references')
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }

  function handleSupplementFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    files.forEach((file) => {
      if (!/\.(md|txt|json)$/iu.test(file.name)) {
        setError('补充节点资料只支持 .md、.txt、.json。')
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = String(e.target?.result ?? '').trim()
        if (!text) return
        setSupplementSources((current) => [
          ...current,
          { id: `supplement-${Date.now()}-${file.name}-${current.length}`, name: file.name, sourceKind: 'upload', text },
        ])
      }
      reader.readAsText(file)
    })
    event.target.value = ''
  }

  function removeSupplementSource(id: string) {
    setSupplementSources((current) => current.filter((source) => source.id !== id))
  }

  function buildMessageContent(text: string): ChatMessage['content'] {
    if (attachments.length === 0) return text

    const fallbackText = text || '请根据这批参考图补齐文档中的布局层级、控件状态、视觉差异和交互细节。'
    const attachmentLines = attachments.map((item, index) => (
      `${index + 1}. ${roleLabel(item.role)}：${item.name}`
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
    if ((!text && attachments.length === 0) || isSending) return

    const content = buildMessageContent(text)
    const hadImages = attachments.length > 0
    setDraft('')
    setAttachments([])
    setError(null)
    setIsSending(true)
    try {
      await onSend(content)
      if (hadImages) setVisualTab('references')
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请重试')
    } finally {
      setIsSending(false)
    }
  }

  async function handleSuggestNodeOperations() {
    const text = draft.trim()
    if ((!text && supplementSources.length === 0) || isSuggesting) return
    setError(null)
    setIsSuggesting(true)
    try {
      await onSuggestNodeOperations({
        supplementText: text,
        sources: supplementSources,
      })
      setDraft('')
      setSupplementSources([])
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成节点建议失败，请重试')
    } finally {
      setIsSuggesting(false)
    }
  }

  async function handleGeneratePrototype(instruction?: string) {
    setVisualTab('prototype')
    await onGeneratePrototype(instruction, { singlePrototypeOnly: !instruction && singlePrototypeOnly })
  }

  function handleClearChat() {
    if (isSending) return
    setAttachments([])
    setSelectedImageId(null)
    setError(null)
    onClearChat()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (visualTab === 'prototype' && prototypeHtml && draft.trim()) {
        void handleGeneratePrototype(draft.trim())
        setDraft('')
      } else {
        void handleSend()
      }
    }
  }

  return (
    <div className="flex min-w-0 flex-1 bg-background blueprint-grid">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-outline-variant/30 bg-surface/80 px-lg py-sm">
          <div className="flex flex-wrap items-center gap-sm">
            {[
              { label: '来源/边界', done: messages.length > 1 },
              { label: '质量门槛', done: nodeComplete },
              { label: '参考证据', done: visualImages.length > 0 },
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
                    <div className="truncate font-mono text-[10px] text-secondary">{roleLabel(item.role)}</div>
                    <div className="truncate font-mono text-[10px] text-on-surface-variant">{item.name}</div>
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

          {supplementSources.length > 0 ? (
            <div className="mb-sm flex gap-xs overflow-x-auto rounded-lg border border-primary/30 bg-primary/10 p-xs">
              {supplementSources.map((source) => (
                <div key={source.id} className="flex max-w-[220px] shrink-0 items-center gap-xs rounded bg-surface-container p-xs">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: '16px' }}>description</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[10px] text-primary">上传资料</div>
                    <div className="truncate font-mono text-[10px] text-on-surface-variant">{source.name}</div>
                  </div>
                  <button
                    onClick={() => removeSupplementSource(source.id)}
                    className="rounded px-xs font-mono text-code-sm text-on-surface-variant hover:bg-surface-container-high hover:text-error"
                    title="移除资料"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-sm">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                visualTab === 'prototype'
                  ? '描述要如何修改右侧原型...'
                  : visualTab === 'compare'
                    ? '指出参考图和原型哪里不一致...'
                    : '补充这篇文档的原文依据、依赖关系、验收标准，或上传参考图...'
              }
              disabled={isSending}
              rows={3}
              className="w-full resize-none rounded-lg border border-outline-variant bg-surface-container px-md py-sm text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-secondary focus:outline-none disabled:opacity-50 transition-colors"
            />

            <div className="flex items-center justify-between gap-md">
              <button
                onClick={onBack}
                className="flex min-h-[36px] items-center gap-xs text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_back</span>
                返回导图
              </button>

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-sm">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setDraft((current) => current || prompt)}
                    className="max-w-[168px] truncate rounded-lg border border-outline-variant bg-surface px-sm py-xs text-left text-body-sm text-on-surface-variant transition-colors hover:border-secondary hover:text-on-surface"
                    title={prompt}
                  >
                    {prompt}
                  </button>
                ))}
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
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-sm text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                  title="上传补充资料生成节点建议"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>attach_file</span>
                  资料
                </button>
                <button
                  onClick={() => void handleSuggestNodeOperations()}
                  disabled={(!draft.trim() && supplementSources.length === 0) || isSuggesting}
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-primary bg-primary-container px-md py-sm text-label-md font-medium text-on-primary-container transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <span className={['material-symbols-outlined', isSuggesting ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {isSuggesting ? 'sync' : 'add_node'}
                  </span>
                  生成节点建议
                </button>
                <button
                  onClick={onConfirm}
                  className={[
                    'flex min-h-[36px] items-center gap-xs rounded-lg border px-md py-sm text-label-md font-medium transition-all',
                    nodeComplete
                      ? 'border-tertiary bg-tertiary-container text-on-tertiary-container active-glow'
                      : 'border-outline-variant bg-secondary-container text-on-secondary-container opacity-60',
                  ].join(' ')}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: '16px',
                      fontVariationSettings: nodeComplete ? "'FILL' 1" : "'FILL' 0",
                    }}
                  >
                    check_circle
                  </span>
                  确认完成
                </button>

                <button
                  onClick={() => void handleSend()}
                  disabled={(!draft.trim() && attachments.length === 0) || isSending}
                  className="flex min-h-[36px] items-center gap-xs rounded-lg border border-secondary bg-secondary-container px-md py-sm text-label-md font-medium text-on-secondary-container transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
                  发送
                </button>
                {visualTab === 'prototype' && prototypeHtml ? (
                  <button
                    onClick={() => {
                      const instruction = draft.trim()
                      if (!instruction) return
                      setDraft('')
                      void handleGeneratePrototype(instruction)
                    }}
                    disabled={!draft.trim() || isGeneratingPrototype}
                    className="flex min-h-[36px] items-center gap-xs rounded-lg border border-secondary/40 bg-secondary/10 px-md py-sm text-label-md font-medium text-secondary transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                    修改原型
                  </button>
                ) : null}
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
          <div className="grid grid-cols-3 gap-xs rounded-lg border border-outline-variant bg-surface p-xs">
            {VISUAL_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setVisualTab(tab.id)}
                className={[
                  'flex items-center justify-center gap-xs rounded px-sm py-xs font-mono text-[11px] transition-colors',
                  visualTab === tab.id
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                ].join(' ')}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {visualTab === 'references' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto p-md">
            <div className="grid grid-cols-4 gap-xs rounded-lg border border-outline-variant bg-surface p-xs">
              {(['reference', 'asset', 'state', 'anti'] as ReferenceRole[]).map((role) => (
                <button
                  key={role}
                  onClick={() => setReferenceRole(role)}
                  className={[
                    'rounded px-xs py-xs font-mono text-[10px] transition-colors',
                    referenceRole === role
                      ? roleTone(role)
                      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                  ].join(' ')}
                >
                  {roleLabel(role)}
                </button>
              ))}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[108px] flex-col items-center justify-center gap-sm rounded-lg border border-dashed border-outline-variant bg-surface/70 px-md py-lg text-center transition-colors hover:border-secondary hover:bg-secondary/10"
            >
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: '28px' }}>
                add_photo_alternate
              </span>
              <span className="font-mono text-label-md uppercase text-secondary">上传到视觉舱</span>
            </button>

            {visualImages.length > 0 ? (
              <div className="grid grid-cols-2 gap-sm">
                {visualImages.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedImageId(item.id)}
                    className={[
                      'overflow-hidden rounded-lg border bg-surface text-left transition-colors',
                      selectedImage?.id === item.id ? 'border-primary active-glow' : 'border-outline-variant hover:border-secondary',
                    ].join(' ')}
                  >
                    <img src={item.previewUrl} alt={item.name} className="h-36 w-full object-cover" />
                    <div className="p-xs">
                      <div className={`inline-flex rounded border px-xs py-[2px] font-mono text-[10px] ${roleTone(item.role)}`}>
                        {roleLabel(item.role)}
                      </div>
                      <div className="mt-xs truncate font-mono text-[10px] text-on-surface-variant">
                        {item.source === 'pending' ? '待发送 · ' : '已进入对话 · '}
                        {item.name}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-outline-variant/60 bg-surface/60 p-md font-mono text-[11px] leading-relaxed text-on-surface-variant">
                上传 UI 截图、竞品参考、状态图或反例图。图片会作为 AI 对话证据进入文档包打磨流程。
              </div>
            )}
          </div>
        ) : null}

        {visualTab === 'prototype' ? (
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
        ) : null}

        {visualTab === 'compare' ? (
          <div className="flex min-h-0 flex-1 overflow-hidden p-md">
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-sm">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface">
                <div className="border-b border-outline-variant px-sm py-xs font-mono text-[10px] uppercase text-on-surface-variant">
                  参考图
                </div>
                {selectedImage ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center bg-black/30 p-sm">
                    <img src={selectedImage.previewUrl} alt={selectedImage.name} className="max-h-full max-w-full rounded object-contain" />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-md text-center font-mono text-[11px] text-on-surface-variant">
                    先上传或选择一张参考图。
                  </div>
                )}
              </div>
              <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface">
                <div className="border-b border-outline-variant px-sm py-xs font-mono text-[10px] uppercase text-on-surface-variant">
                  生成原型
                </div>
                <div className="flex min-h-0 flex-1 overflow-hidden bg-black/30">
                  <PrototypePreviewSurface
                    html={selectedPrototypeHtml}
                    title="生成原型"
                    interactive
                    fit="pane"
                    fallback={(
                      <div className="flex h-full w-full items-center justify-center p-sm text-center font-mono text-[11px] text-on-surface-variant">
                        生成后在这里显示原型。
                      </div>
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
