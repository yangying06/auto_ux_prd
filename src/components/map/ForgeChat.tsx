import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../types/chat'

interface ForgeChatProps {
  nodeId: string
  messages: ChatMessage[]
  nodeComplete: boolean
  onSend: (text: string) => void | Promise<void>
  onConfirm: () => void
  onBack: () => void
}

function getTextContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b.text ?? '') : ''))
    .join('\n')
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const text = getTextContent(msg.content)
  if (msg.role === 'user') {
    return (
      <div className="bg-secondary-container text-on-secondary-container rounded-2xl px-md py-sm self-end max-w-[75%] whitespace-pre-line text-body-md">
        {text}
      </div>
    )
  }
  return (
    <div className="bg-surface-container text-on-surface rounded-2xl px-md py-sm self-start max-w-[80%] whitespace-pre-line text-body-md animate-fade-in">
      {text}
    </div>
  )
}

function LoadingIndicator() {
  return (
    <div className="flex gap-xs self-start">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-2 h-2 rounded-full bg-secondary animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}

function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="rounded-lg px-md py-sm bg-error-container text-on-error-container text-body-md flex justify-between items-center gap-sm">
      <span>{error}</span>
      <button onClick={onDismiss} className="shrink-0 text-on-error-container hover:opacity-80 font-bold">
        ×
      </button>
    </div>
  )
}

export function ForgeChat({ nodeId: _nodeId, messages, nodeComplete, onSend, onConfirm, onBack }: ForgeChatProps) {
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = draft.trim()
    if (!text || isSending) return
    setDraft('')
    setError(null)
    setIsSending(true)
    try {
      await onSend(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请重试')
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-background blueprint-grid overflow-hidden">
      <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isSending && <LoadingIndicator />}
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 px-lg py-md border-t border-outline-variant bg-surface flex flex-col gap-sm">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述这个节点的交互细节..."
          disabled={isSending}
          rows={3}
          className="w-full resize-none rounded-lg bg-surface-container border border-outline-variant
            text-body-md text-on-surface placeholder:text-on-surface-variant
            px-md py-sm focus:outline-none focus:border-secondary
            disabled:opacity-50 transition-colors"
        />
        <div className="flex justify-between items-center">
          <button
            onClick={onBack}
            className="flex items-center gap-xs text-label-md text-on-surface-variant
              hover:text-on-surface transition-colors min-h-[36px]"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_back</span>
            返回导图
          </button>

          <div className="flex items-center gap-sm">
            <button
              onClick={onConfirm}
              className={[
                'flex items-center gap-xs rounded-lg px-md py-sm text-label-md transition-all min-h-[36px] border font-medium',
                nodeComplete
                  ? 'bg-tertiary-container text-on-tertiary-container active-glow border-tertiary'
                  : 'bg-secondary-container text-on-secondary-container opacity-60 border-outline-variant',
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
              disabled={!draft.trim() || isSending}
              className="flex items-center gap-xs rounded-lg px-md py-sm text-label-md
                bg-secondary-container text-on-secondary-container border border-secondary
                disabled:opacity-40 hover:opacity-90 transition-opacity min-h-[36px] font-medium"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
