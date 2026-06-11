import { useEffect, useRef, useState } from 'react'
import { requestMapAdjustment } from '../../lib/api'
import { findLatestUserMessageIndex, getTextFromMessage } from '../../lib/chatRecall'
import { getClipboardImageFiles, readImageFileAsClipboardAttachment } from '../../lib/clipboardImages'
import { useAppStore } from '../../store/appStore'
import type { ChatMessage, ImageBlock } from '../../types/chat'
import type { MapAdjustmentOperation, PrdTree } from '../../types/prdNode'

interface MapAdjustmentPanelProps {
  baseUrl: string
  tree: PrdTree
  onApply: (operations: MapAdjustmentOperation[]) => void
}

interface AdjustmentImageAttachment {
  id: string
  name: string
  mediaType: ImageBlock['source']['media_type']
  data: string
  previewUrl: string
  size: number
}

interface AdjustmentTextAttachment {
  id: string
  name: string
  size: number
  text: string
  truncated: boolean
}

const MAX_ADJUSTMENT_IMAGES = 4
const MAX_ADJUSTMENT_IMAGE_SIZE = 4 * 1024 * 1024
const MAX_ADJUSTMENT_TEXT_FILES = 6
const MAX_ADJUSTMENT_FILE_CHARS = 60000
const MAX_ADJUSTMENT_TOTAL_FILE_CHARS = 160000
const SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS = ['.txt', '.md', '.json', '.jsonc']
const MESSAGE_WRAP_CLASS = 'min-w-0 max-w-full break-words [overflow-wrap:anywhere]'

function operationLabel(operation: MapAdjustmentOperation) {
  if (operation.type === 'create_node') return `新增页面：${operation.title}`
  if (operation.type === 'delete_node') return `已保护：忽略删除节点 ${operation.nodeId}`
  if (operation.type === 'update_node') return `更新节点：${operation.nodeId}`
  if (operation.type === 'move_content') return `复制补充内容：${operation.fromNodeId} → ${operation.toNodeId}`
  return `添加引用：${operation.sourceNodeId} → ${operation.targetNodeId}`
}

function messageText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

function messageImages(content: ChatMessage['content']) {
  if (typeof content === 'string') return []
  return content.filter((block): block is ImageBlock => block.type === 'image')
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function LoadingLabel({ label }: { label: string }) {
  const [dotCount, setDotCount] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setDotCount((current) => (current + 1) % 4), 360)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <>
      {label}
      <span className="inline-block w-4 text-left">{'.'.repeat(dotCount)}</span>
    </>
  )
}

function formatSendError(message: string) {
  if (!message.includes('本地代理')) return message
  return `${message}\n\n已保留本次反馈。请确认已通过 npm run dev 同时启动前后端，或单独运行 npm run dev:server 后重试。`
}

function fileExtension(name: string) {
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index).toLowerCase()
}

function isSupportedTextAttachment(file: File) {
  return SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS.includes(fileExtension(file.name))
}

function buildAttachmentText(draftText: string, textAttachments: AdjustmentTextAttachment[]) {
  const sections = [draftText]
  for (const attachment of textAttachments) {
    sections.push([
      `\n\n--- 补充资料：${attachment.name}${attachment.truncated ? '（已截断）' : ''} ---`,
      attachment.text,
      `--- 补充资料结束：${attachment.name} ---`,
    ].join('\n'))
  }
  return sections.filter((section) => section.trim().length > 0).join('\n')
}

export function MapAdjustmentPanel({ baseUrl, tree, onApply }: MapAdjustmentPanelProps) {
  const messages = useAppStore((s) => s.mapAdjustmentMessages)
  const setMessages = useAppStore((s) => s.setMapAdjustmentMessages)
  const removeLastTurn = useAppStore((s) => s.removeLastMapAdjustmentTurn)
  const pendingOperations = useAppStore((s) => s.pendingMapAdjustmentOperations)
  const setPendingOperations = useAppStore((s) => s.setPendingMapAdjustmentOperations)
  const [draft, setDraft] = useState('')
  const [imageAttachments, setImageAttachments] = useState<AdjustmentImageAttachment[]>([])
  const [textAttachments, setTextAttachments] = useState<AdjustmentTextAttachment[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSend() {
    const draftBeforeSend = draft
    const sentImageAttachments = imageAttachments
    const sentTextAttachments = textAttachments
    const text = draft.trim()
    if ((!text && imageAttachments.length === 0 && textAttachments.length === 0) || isSending) return
    const textWithAttachments = buildAttachmentText(text, textAttachments)
    const content: ChatMessage['content'] = imageAttachments.length > 0
      ? [
          { type: 'text', text: textWithAttachments || '请根据添加的图片资料，判断导图结构是否需要调整。' },
          ...imageAttachments.map((image) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: image.mediaType,
              data: image.data,
            },
          })),
        ]
      : textWithAttachments
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(nextMessages)
    setDraft('')
    setImageAttachments([])
    setTextAttachments([])
    if (fileInputRef.current) fileInputRef.current.value = ''
    setError(null)
    setIsSending(true)
    try {
      const response = await requestMapAdjustment(baseUrl, nextMessages, tree)
      setMessages([...nextMessages, { role: 'assistant', content: response.reply }])
      setPendingOperations(response.operations)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 调整请求失败'
      setMessages(messages)
      setDraft(draftBeforeSend)
      setImageAttachments(sentImageAttachments)
      setTextAttachments(sentTextAttachments)
      setPendingOperations([])
      setError(formatSendError(message))
    } finally {
      setIsSending(false)
    }
  }

  function removeImageAttachment(id: string) {
    setImageAttachments((current) => current.filter((image) => image.id !== id))
  }

  function removeTextAttachment(id: string) {
    setTextAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  async function addImageFile(file: File, fallbackNamePrefix: string) {
    if (file.size > MAX_ADJUSTMENT_IMAGE_SIZE) {
      setError('单张图片不能超过 4MB。')
      return
    }
    const image = await readImageFileAsClipboardAttachment(file, `${fallbackNamePrefix}-${Date.now()}.png`)
    setImageAttachments((current) => [
      ...current,
      {
        id: `map-adjustment-${Date.now()}-${image.name}-${current.length}`,
        name: image.name,
        mediaType: image.mediaType,
        data: image.data,
        previewUrl: image.previewUrl,
        size: image.size,
      },
    ])
  }

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    setError(null)
    const usedChars = textAttachments.reduce((sum, attachment) => sum + attachment.text.length, 0)
    let remainingTextBudget = Math.max(0, MAX_ADJUSTMENT_TOTAL_FILE_CHARS - usedChars)
    let availableImageSlots = Math.max(0, MAX_ADJUSTMENT_IMAGES - imageAttachments.length)
    let availableTextSlots = Math.max(0, MAX_ADJUSTMENT_TEXT_FILES - textAttachments.length)
    const nextTextAttachments: AdjustmentTextAttachment[] = []

    try {
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          if (availableImageSlots <= 0) {
            setError(`最多保留 ${MAX_ADJUSTMENT_IMAGES} 张导图调整参考图。`)
            continue
          }
          await addImageFile(file, 'map-adjustment-file')
          availableImageSlots -= 1
          continue
        }

        if (!isSupportedTextAttachment(file)) {
          setError('仅支持 txt、md、json、jsonc 和图片附件。')
          continue
        }

        if (availableTextSlots <= 0 || remainingTextBudget <= 0) {
          setError(`最多保留 ${MAX_ADJUSTMENT_TEXT_FILES} 个文本资料附件。`)
          continue
        }

        const rawText = await file.text()
        const limit = Math.max(0, Math.min(MAX_ADJUSTMENT_FILE_CHARS, remainingTextBudget))
        const truncated = rawText.length > limit
        const clippedText = truncated
          ? `${rawText.slice(0, limit)}\n\n[附件内容过长，后续内容已截断]`
          : rawText
        remainingTextBudget -= clippedText.length
        availableTextSlots -= 1
        nextTextAttachments.push({
          id: `map-adjustment-text-${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          size: file.size,
          text: clippedText,
          truncated,
        })
      }

      if (nextTextAttachments.length) {
        setTextAttachments((current) => [...current, ...nextTextAttachments])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取附件失败，请重试。')
    } finally {
      event.target.value = ''
    }
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = getClipboardImageFiles(event.clipboardData)
    if (!files.length) return

    event.preventDefault()
    const availableSlots = Math.max(0, MAX_ADJUSTMENT_IMAGES - imageAttachments.length)
    const imagesToRead = files.slice(0, availableSlots)
    if (files.length > availableSlots) {
      setError(`最多保留 ${MAX_ADJUSTMENT_IMAGES} 张导图调整参考图。`)
    } else {
      setError(null)
    }

    try {
      for (const file of imagesToRead) {
        await addImageFile(file, 'map-adjustment-paste')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '粘贴图片失败，请重试。')
    }
  }

  function restoreRecalledMessage(message: ChatMessage) {
    setDraft(getTextFromMessage(message.content))
    setImageAttachments(messageImages(message.content).map((block, index) => ({
      id: `recalled-map-${Date.now()}-${index}`,
      name: `recalled-map-image-${index + 1}`,
      mediaType: block.source.media_type,
      data: block.source.data,
      previewUrl: `data:${block.source.media_type};base64,${block.source.data}`,
      size: 0,
    })))
    setTextAttachments([])
  }

  function handleRemoveLastTurn(restoreDraft: boolean) {
    if (isSending) return
    const recalledMessage = removeLastTurn()
    if (!recalledMessage) return
    if (restoreDraft) {
      restoreRecalledMessage(recalledMessage)
    } else {
      setDraft('')
      setImageAttachments([])
      setTextAttachments([])
    }
    setError(null)
  }

  function handleApply() {
    if (!pendingOperations.length) return
    onApply(pendingOperations.filter((operation) => operation.type !== 'delete_node'))
    setPendingOperations([])
  }

  const lastUserIndex = findLatestUserMessageIndex(messages)
  const canRemoveLastTurn = lastUserIndex !== -1 && !isSending

  if (isCollapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-outline-variant bg-surface-container-low py-md">
        <button
          onClick={() => setIsCollapsed(false)}
          title="展开 AI 调整拆分"
          aria-label="展开 AI 调整拆分"
          className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_right</span>
        </button>
        <span className="material-symbols-outlined mt-sm text-primary" style={{ fontSize: '20px' }}>auto_awesome</span>
      </aside>
    )
  }

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-outline-variant bg-surface-container-low">
      <div className="relative border-b border-outline-variant p-md pr-12">
        <div className="flex items-center gap-sm text-primary">
          <span className="material-symbols-outlined">auto_awesome</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface">AI 调整拆分</h2>
        </div>
        <p className="mt-xs text-body-sm text-on-surface-variant">先预览操作，再确认应用。</p>
        <button
          onClick={() => setIsCollapsed(true)}
          title="收缩 AI 调整拆分"
          aria-label="收缩 AI 调整拆分"
          className="absolute right-sm top-sm rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_left</span>
        </button>
      </div>

      <div className="custom-scrollbar flex-1 space-y-sm overflow-y-auto p-md">
        {messages.map((message, index) => (
          <div
            key={index}
            className={[
              `rounded-lg border p-sm text-body-sm leading-relaxed ${MESSAGE_WRAP_CLASS}`,
              message.role === 'user'
                ? 'border-primary/30 bg-primary-container/20 text-on-surface'
                : 'border-outline-variant bg-surface-container text-on-surface-variant',
            ].join(' ')}
          >
            <div className={`whitespace-pre-wrap ${MESSAGE_WRAP_CLASS}`}>{messageText(message.content)}</div>
            {messageImages(message.content).length > 0 ? (
              <div className="mt-xs grid grid-cols-2 gap-xs">
                {messageImages(message.content).map((block, imageIndex) => (
                  <img
                    key={imageIndex}
                    src={`data:${block.source.media_type};base64,${block.source.data}`}
                    alt="导图调整参考图"
                    className="h-24 w-full rounded border border-outline-variant object-cover"
                  />
                ))}
              </div>
            ) : null}
            {message.role === 'user' && index === lastUserIndex && canRemoveLastTurn ? (
              <div className="mt-xs flex justify-end gap-xs border-t border-primary/20 pt-xs">
                <button
                  type="button"
                  onClick={() => handleRemoveLastTurn(true)}
                  className="rounded px-xs py-[2px] text-[11px] text-on-surface-variant transition-colors hover:bg-secondary/10 hover:text-secondary"
                  title="撤回这条消息并回填到输入框"
                >
                  撤回
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveLastTurn(false)}
                  className="rounded px-xs py-[2px] text-[11px] text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error"
                  title="清理这条消息"
                >
                  清理
                </button>
              </div>
            ) : null}
            {/*
            {typeof message.content === 'string' ? message.content : '图片消息不用于导图调整'}
            */}
          </div>
        ))}

        {pendingOperations.length > 0 && (
          <div className="rounded-lg border border-secondary/50 bg-secondary-container/20 p-sm">
            <div className="mb-xs font-label-md text-label-md text-on-surface">待确认操作</div>
            <ul className="space-y-xs text-body-sm text-on-surface-variant">
              {pendingOperations.map((operation, index) => (
                <li key={index}>• {operationLabel(operation)}</li>
              ))}
            </ul>
            <div className="mt-sm flex gap-xs">
              <button
                onClick={handleApply}
                className="flex-1 rounded bg-secondary-container px-sm py-xs text-label-md text-on-secondary-container hover:bg-secondary-container/90"
              >
                确认应用
              </button>
              <button
                onClick={() => setPendingOperations([])}
                className="flex-1 rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-variant"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {error && <div className="rounded border border-error/40 bg-error/10 p-sm text-body-sm text-error">{error}</div>}
      </div>

      <div className="border-t border-outline-variant p-md">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => { void handlePaste(event) }}
          placeholder="例如：把排行榜从主界面拆成独立页面"
          className="h-24 w-full resize-none rounded-lg border border-outline-variant bg-surface p-sm text-body-sm text-on-surface outline-none focus:border-primary"
        />
        {(imageAttachments.length > 0 || textAttachments.length > 0) ? (
          <div className="mt-sm space-y-xs rounded-lg border border-primary/30 bg-primary-container/15 p-xs">
            {textAttachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-xs rounded bg-surface p-xs">
                <span className="material-symbols-outlined shrink-0 text-primary" style={{ fontSize: '18px' }}>description</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] text-on-surface">{attachment.name}</div>
                  <div className="font-mono text-[9px] text-on-surface-variant">
                    {formatBytes(attachment.size)}{attachment.truncated ? ' · 已截断' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeTextAttachment(attachment.id)}
                  className="rounded px-xs text-on-surface-variant hover:bg-surface-container-high hover:text-error"
                  aria-label={`移除 ${attachment.name}`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                </button>
              </div>
            ))}
            {imageAttachments.length > 0 ? (
              <div className="flex gap-xs overflow-x-auto">
            {imageAttachments.map((image) => (
              <div key={image.id} className="flex w-[140px] shrink-0 items-center gap-xs rounded bg-surface p-xs">
                <img src={image.previewUrl} alt={image.name} className="h-10 w-10 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] text-on-surface">{image.name}</div>
                  <div className="font-mono text-[9px] text-on-surface-variant">{formatBytes(image.size)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeImageAttachment(image.id)}
                  className="rounded px-xs text-on-surface-variant hover:bg-surface-container-high hover:text-error"
                  aria-label="移除参考图"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                </button>
              </div>
            ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.json,.jsonc,image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={handleFilesSelected}
        />
        <div className="mt-sm flex items-center gap-xs">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-outline-variant bg-surface text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            title="添加补充资料"
            aria-label="添加补充资料"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>attach_file</span>
          </button>
          <button
            onClick={handleSend}
            disabled={(!draft.trim() && imageAttachments.length === 0 && textAttachments.length === 0) || isSending}
            className="h-10 flex-1 rounded-lg border border-outline-variant bg-white px-md text-label-md text-black transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            {isSending ? <LoadingLabel label="分析中" /> : '生成调整建议'}
          </button>
        </div>
      </div>
    </aside>
  )
}
