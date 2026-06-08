import { useEffect, useRef, useState } from 'react'
import type { NodeOperationSourceInput } from '../../lib/api'
import type { PrdNodeOperationSuggestion } from '../../types/prdNode'
import { NodeOperationReview } from './NodeOperationReview'

const MAX_FILE_CHARS = 60000
const MAX_TOTAL_CHARS = 180000

export interface AddNodePayload {
  title: string
  supplementText: string
  sources: NodeOperationSourceInput[]
}

interface LocalAttachment {
  id: string
  name: string
  size: number
  text: string
  truncated: boolean
}

interface AddNodeModalProps {
  isOpen: boolean
  isSubmitting: boolean
  error: string | null
  assistantReply: string | null
  createdNodeLabel: string | null
  suggestions: PrdNodeOperationSuggestion[]
  onCreate: (payload: AddNodePayload) => Promise<void>
  onClose: () => void
  onApplySuggestion: (suggestionId: string) => void
  onDismissSuggestion: (suggestionId: string) => void
  onApplyAllSuggestions: () => void
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function clipFileText(text: string, remainingBudget: number) {
  const limit = Math.max(0, Math.min(MAX_FILE_CHARS, remainingBudget))
  if (text.length <= limit) return { text, truncated: false }
  return {
    text: `${text.slice(0, limit)}\n\n[附件内容过长，后续内容已截断]`,
    truncated: true,
  }
}

export function AddNodeModal({
  isOpen,
  isSubmitting,
  error,
  assistantReply,
  createdNodeLabel,
  suggestions,
  onCreate,
  onClose,
  onApplySuggestion,
  onDismissSuggestion,
  onApplyAllSuggestions,
}: AddNodeModalProps) {
  const [title, setTitle] = useState('')
  const [supplementText, setSupplementText] = useState('')
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) {
      setTitle('')
      setSupplementText('')
      setAttachments([])
      setFileError(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const isCreated = Boolean(createdNodeLabel)
  const canSubmit = title.trim().length > 0 && !isSubmitting && !isCreated

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    setFileError(null)
    const usedChars = attachments.reduce((sum, attachment) => sum + attachment.text.length, 0)
    let remainingBudget = Math.max(0, MAX_TOTAL_CHARS - usedChars)
    const nextAttachments: LocalAttachment[] = []

    for (const file of files) {
      if (remainingBudget <= 0) {
        setFileError('附件文本已达到本次分析上限。')
        break
      }

      try {
        const rawText = await file.text()
        const clipped = clipFileText(rawText, remainingBudget)
        remainingBudget -= clipped.text.length
        nextAttachments.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          size: file.size,
          text: clipped.text,
          truncated: clipped.truncated,
        })
      } catch {
        setFileError(`无法读取附件：${file.name}`)
      }
    }

    if (nextAttachments.length) {
      setAttachments((current) => [...current, ...nextAttachments])
    }
    event.target.value = ''
  }

  function handleRemoveAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    await onCreate({
      title: title.trim(),
      supplementText: supplementText.trim(),
      sources: attachments.map((attachment) => ({
        name: attachment.name,
        sourceKind: 'upload',
        text: attachment.text,
      })),
    })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-lg backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-[720px] flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low shadow-2xl">
        <div className="flex items-center justify-between border-b border-outline-variant px-lg py-md">
          <div className="flex min-w-0 items-center gap-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary-container/40 text-primary">
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>add</span>
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-headline-sm text-headline-sm text-on-surface">新增页面节点</h2>
              {createdNodeLabel && (
                <p className="truncate text-body-sm text-on-surface-variant">{createdNodeLabel}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        <form id="add-node-form" onSubmit={handleSubmit} className="custom-scrollbar flex-1 overflow-y-auto p-lg">
          {!isCreated && (
            <div className="space-y-md">
              <label className="block">
                <span className="mb-xs block font-label-md text-label-md text-on-surface">节点名称</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                  placeholder="例如：赛季任务面板"
                  className="w-full rounded-lg border border-outline-variant bg-surface px-md py-sm text-body-md text-on-surface outline-none transition-colors focus:border-primary"
                />
              </label>

              <label className="block">
                <span className="mb-xs block font-label-md text-label-md text-on-surface">补充说明</span>
                <textarea
                  value={supplementText}
                  onChange={(event) => setSupplementText(event.target.value)}
                  placeholder="输入这个节点需要覆盖的交互、状态、规则或疑点"
                  className="h-28 w-full resize-none rounded-lg border border-outline-variant bg-surface px-md py-sm text-body-md text-on-surface outline-none transition-colors focus:border-primary"
                />
              </label>

              <div>
                <div className="mb-xs flex items-center justify-between gap-sm">
                  <span className="font-label-md text-label-md text-on-surface">资料附件</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-xs rounded-lg border border-outline-variant bg-surface-container px-sm py-xs text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>attach_file</span>
                    上传资料
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.txt,.json,.csv,.log,.xml,.yaml,.yml"
                  className="hidden"
                  onChange={handleFilesSelected}
                />
                {attachments.length > 0 ? (
                  <div className="space-y-xs rounded-lg border border-outline-variant bg-surface p-sm">
                    {attachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center gap-sm rounded border border-outline-variant/70 bg-surface-container px-sm py-xs">
                        <span className="material-symbols-outlined shrink-0 text-primary" style={{ fontSize: '18px' }}>description</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-label-md text-on-surface">{attachment.name}</div>
                          <div className="font-code-sm text-code-sm text-on-surface-variant">
                            {formatBytes(attachment.size)}{attachment.truncated ? ' · 已截断' : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(attachment.id)}
                          aria-label={`移除 ${attachment.name}`}
                          className="rounded p-xs text-on-surface-variant hover:bg-surface-variant hover:text-error"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-outline-variant bg-surface/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>upload_file</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {assistantReply && (
            <div className="mt-md rounded-lg border border-primary/30 bg-primary-container/20 p-sm text-body-sm text-on-surface-variant">
              {assistantReply}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="mt-md space-y-sm">
              <div className="flex items-center justify-between gap-sm">
                <div className="font-label-md text-label-md text-on-surface">MVC 拆分建议</div>
                <button
                  type="button"
                  onClick={onApplyAllSuggestions}
                  className="rounded-lg border border-primary bg-primary-container px-sm py-xs text-label-md text-on-primary-container hover:opacity-90"
                >
                  全部应用
                </button>
              </div>
              <NodeOperationReview
                suggestions={suggestions}
                onApply={onApplySuggestion}
                onDismiss={onDismissSuggestion}
              />
            </div>
          )}

          {(fileError || error) && (
            <div className="mt-md rounded-lg border border-error/40 bg-error/10 p-sm text-body-sm text-error">
              {fileError ?? error}
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-sm border-t border-outline-variant px-lg py-md">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant px-md py-sm text-label-md text-on-surface-variant hover:bg-surface-variant"
          >
            {isCreated ? '完成' : '取消'}
          </button>
          {!isCreated && (
            <button
              type="submit"
              form="add-node-form"
              disabled={!canSubmit}
              className="inline-flex items-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md text-on-primary transition-opacity hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="material-symbols-outlined animate-spin" style={{ fontSize: '16px' }}>progress_activity</span>
              ) : (
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>auto_awesome</span>
              )}
              {attachments.length || supplementText.trim() ? '创建并分析' : '创建节点'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
