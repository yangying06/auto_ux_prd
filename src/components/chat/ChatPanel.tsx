import { useRef, useState } from 'react'
import { sendChatMessage } from '../../lib/api'
import { useAppStore } from '../../store/appStore'
import type { ContentBlock, ImageBlock } from '../../types/chat'

interface ChatPanelProps {
  onOpenSettings: () => void
  onBack?: () => void
  onConfirm?: () => void
}

type Attachment =
  | { kind: 'text'; name: string; content: string }
  | { kind: 'image'; name: string; mediaType: ImageBlock['source']['media_type']; data: string; previewUrl: string }

function renderMessageContent(content: string | ContentBlock[]) {
  if (typeof content === 'string') return <p className="whitespace-pre-line leading-relaxed">{content}</p>
  return (
    <div className="flex flex-col gap-sm">
      {content.map((block, i) => {
        if (block.type === 'text') return <p key={i}>{block.text}</p>
        return (
          <img
            key={i}
            src={`data:${block.source.media_type};base64,${block.source.data}`}
            alt="附件图片"
            className="max-h-48 max-w-full rounded-lg object-contain"
          />
        )
      })}
    </div>
  )
}

function getFallbackQuestion(requirement: ReturnType<typeof useAppStore.getState>['requirement']) {
  if (!requirement.trigger_condition) return requirement.missing_reasons.trigger_condition ?? '请补充：这个交互由什么玩家行为或系统事件触发？'
  if (!requirement.sequence_rules) return requirement.missing_reasons.sequence_rules ?? '请补充：触发后动画、反馈和状态变化的执行顺序是什么？'
  if (!requirement.asset_dependencies.length || requirement.asset_dependencies.some((asset) => !asset.is_ready || !asset.path)) {
    return requirement.missing_reasons.asset_dependencies ?? '请补充：这个交互需要哪些资源路径、预制体、音效或特效？'
  }
  if (!requirement.engine_constraints) return requirement.missing_reasons.engine_constraints ?? '请补充：有没有 Cocos Creator 相关的实现约束或版本要求？'
  return null
}

function compactQuestion(question: string) {
  return question
    .replace(/^(请补充|还缺|Suggested next question)[:：]\s*/i, '')
    .split(/[\n。]/)[0]
    .trim()
}

export function ChatPanel({ onOpenSettings, onBack, onConfirm }: ChatPanelProps) {
  const requirement = useAppStore((state) => state.requirement)
  const messages = useAppStore((state) => state.messages)
  const settings = useAppStore((state) => state.settings)
  const setMessages = useAppStore((state) => state.setMessages)
  const applyRequirementPatch = useAppStore((state) => state.applyRequirementPatch)
  const setLatestRag = useAppStore((state) => state.setLatestRag)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addAttachment(nextAttachment: Attachment) {
    setAttachments((current) => [...current, nextAttachment])
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, i) => i !== index))
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    files.forEach((file) => {
      const isImage = file.type.startsWith('image/')
      const reader = new FileReader()
      if (isImage) {
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string
          const base64 = dataUrl.split(',')[1]
          const mediaType = file.type as ImageBlock['source']['media_type']
          addAttachment({ kind: 'image', name: file.name, mediaType, data: base64, previewUrl: dataUrl })
        }
        reader.readAsDataURL(file)
      } else {
        reader.onload = (e) => {
          addAttachment({ kind: 'text', name: file.name, content: e.target?.result as string })
        }
        reader.readAsText(file, 'utf-8')
      }
    })

    event.target.value = ''
  }

  async function handleSend() {
    const text = draft.trim()
    if ((!text && attachments.length === 0) || isSending) return

    const imageAttachments = attachments.filter((item): item is Extract<Attachment, { kind: 'image' }> => item.kind === 'image')
    const textAttachments = attachments.filter((item): item is Extract<Attachment, { kind: 'text' }> => item.kind === 'text')
    const textWithAttachments = [
      text,
      ...textAttachments.map((item) => `[附件: ${item.name}]\n\`\`\`\n${item.content}\n\`\`\``),
    ].filter(Boolean).join('\n\n')

    const messageContent: string | ContentBlock[] = imageAttachments.length > 0
      ? [
          ...(textWithAttachments ? [{ type: 'text' as const, text: textWithAttachments }] : []),
          ...imageAttachments.map((item) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: item.mediaType, data: item.data } })),
        ]
      : textWithAttachments

    const nextMessages = [...messages, { role: 'user' as const, content: messageContent }]
    setMessages(nextMessages)
    setDraft('')
    setAttachments([])
    setError(null)
    setIsSending(true)

    try {
      const response = await sendChatMessage(settings.proxyBaseUrl, nextMessages, requirement)
      setMessages((current) => [...current, { role: 'assistant', content: response.reply }])
      applyRequirementPatch(response.statePatch)
      setLatestRag(response.rag ?? null)
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : '发送失败，请检查本地代理。'
      setError(message)
      setMessages((current) => [...current, { role: 'assistant', content: `本地代理未完成响应：${message}` }])
    } finally {
      setIsSending(false)
    }
  }

  function handleRecall() {
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user')
    if (lastUserIndex === -1) return
    const lastUser = messages[lastUserIndex]
    const text = typeof lastUser.content === 'string'
      ? lastUser.content
      : lastUser.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('\n')
    setDraft(text)
    if (typeof lastUser.content !== 'string') {
      const recalledImages = lastUser.content
        .filter((b): b is ImageBlock => b.type === 'image')
        .map((block, index) => ({
          kind: 'image' as const,
          name: `recalled-image-${index + 1}`,
          mediaType: block.source.media_type,
          data: block.source.data,
          previewUrl: `data:${block.source.media_type};base64,${block.source.data}`,
        }))
      setAttachments(recalledImages)
    } else {
      setAttachments([])
    }
    setMessages(messages.slice(0, lastUserIndex))
  }

  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user')
  const nextQuestion = requirement.next_question ?? getFallbackQuestion(requirement)
  const currentQuestion = nextQuestion ? compactQuestion(nextQuestion) : null
  const inputPlaceholder = currentQuestion ?? '描述你的交互意图或逻辑...'

  return (
    <aside className="relative z-10 flex h-full w-[35%] min-w-[360px] flex-col border-r border-outline-variant/30 bg-surface-container">
      <header className="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-high/50 px-lg py-md backdrop-blur-sm">
        <div>
          <h1 className="text-headline-sm font-semibold text-on-surface">GameUX PromptForge</h1>
          <div className="mt-xs flex items-center gap-sm">
            <div className="pulse-dot h-2 w-2 rounded-full bg-tertiary" />
            <span className="font-mono text-label-md uppercase text-tertiary">Cocos RAG 已连接</span>
          </div>
        </div>
        <div className="flex items-center gap-sm">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-xs rounded-md px-sm py-xs font-mono text-code-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>arrow_back</span>
              返回导图
            </button>
          )}
          {onConfirm && (
            <button
              onClick={onConfirm}
              className="flex items-center gap-xs rounded-lg border border-tertiary/50 bg-tertiary-container/20 px-sm py-xs font-mono text-code-sm text-tertiary transition-colors hover:bg-tertiary-container/40"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
              确认完成
            </button>
          )}
          <button onClick={onOpenSettings} className="rounded-md px-sm py-xs font-mono text-code-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface">
            设置
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-lg overflow-y-auto p-lg">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={message.role === 'user' ? 'group flex max-w-[90%] flex-row-reverse gap-md self-end' : 'flex max-w-[90%] gap-md'}
          >
            <div
              className={
                message.role === 'user'
                  ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-secondary-container/50 bg-secondary-container text-on-secondary-container'
                  : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container-highest text-tertiary'
              }
            >
              {message.role === 'user' ? 'U' : 'AI'}
            </div>
            <div className="flex flex-col items-end gap-xs">
              <div
                className={
                  message.role === 'user'
                    ? 'rounded-xl rounded-tr-sm border border-secondary-container/30 bg-secondary-container/20 p-md text-on-surface'
                    : 'max-w-full rounded-xl rounded-tl-sm border border-outline-variant/20 bg-surface-container-high p-md text-on-surface'
                }
              >
                {renderMessageContent(message.content)}
              </div>
              {message.role === 'user' && index === lastUserIndex && !isSending ? (
                <button
                  onClick={handleRecall}
                  className="font-mono text-[10px] text-on-surface-variant/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-error"
                >
                  撤回
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {isSending ? (
          <div className="flex max-w-[90%] gap-md opacity-50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container-highest text-tertiary">
              AI
            </div>
            <div className="flex items-center gap-xs rounded-xl rounded-tl-sm border border-outline-variant/20 bg-surface-container-high px-md py-sm">
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant [animation-delay:300ms]" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-outline-variant/20 bg-surface-container-low p-md">
        {/* GDevelop SuggestionLines 模式：多个可点击快捷回答 */}
        {requirement.suggested_answers.length > 0 && messages.length > 0 && !isSending ? (
          <div className="mb-sm flex flex-wrap gap-xs">
            {requirement.suggested_answers.map((answer, i) => (
              <button
                key={i}
                onClick={() => setDraft((prev) => prev || answer)}
                className="rounded-lg border border-secondary/40 bg-secondary/10 px-sm py-xs font-mono text-code-sm text-secondary transition-colors hover:bg-secondary/20 active:scale-[0.99]"
                title="点击预填此回答"
              >
                {answer}
              </button>
            ))}
          </div>
        ) : currentQuestion && messages.length > 0 && !isSending ? (
          <button
            onClick={() => setDraft((prev) => prev || `关于"${currentQuestion}"：`)}
            className="mb-sm w-full rounded-lg border border-secondary/40 bg-secondary/10 px-sm py-xs text-left font-mono text-code-sm text-secondary transition-colors hover:bg-secondary/20 active:scale-[0.99]"
            title="点击快速回答此问题"
          >
            💬 {currentQuestion}
          </button>
        ) : null}
        {error ? <div className="mb-sm rounded-lg border border-error/30 bg-error/10 p-sm font-mono text-code-sm text-error">{error}</div> : null}
        {attachments.length > 0 ? (
          <div className="mb-sm grid max-h-40 gap-xs overflow-auto rounded-lg border border-secondary/30 bg-secondary/10 p-sm">
            {attachments.map((item, index) => (
              <div key={`${item.name}-${index}`} className="flex items-center gap-sm rounded-md bg-surface-container/70 p-xs">
                {item.kind === 'image' ? (
                  <img src={item.previewUrl} alt={item.name} className="h-12 w-12 rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-surface-container-high font-mono text-code-sm text-secondary">TXT</div>
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-code-sm text-secondary">{item.name}</span>
                <button onClick={() => removeAttachment(index)} className="font-mono text-code-sm text-on-surface-variant hover:text-error">✕</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col rounded-xl border border-outline-variant/50 bg-surface p-sm transition-all focus-within:border-secondary focus-within:ring-1 focus-within:ring-secondary/20">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend() } }}
            className="min-h-[80px] w-full resize-none border-none bg-transparent font-body text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none"
            placeholder={inputPlaceholder}
          />
          <div className="mt-sm flex items-center justify-between border-t border-outline-variant/20 pt-sm">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.json,image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="添加附件"
              title="添加附件"
              className="rounded-md px-sm py-sm text-xl leading-none text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              📎
            </button>
            <button
              onClick={handleSend}
              disabled={isSending || (!draft.trim() && attachments.length === 0)}
              className="rounded-lg bg-secondary-container px-md py-sm font-mono text-label-md uppercase text-on-secondary-container shadow-[0_0_12px_rgba(5,102,217,0.3)] transition-colors hover:bg-secondary-container/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSending ? '发送中' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
