import { useState } from 'react'
import { requestMapAdjustment } from '../../lib/api'
import type { ChatMessage } from '../../types/chat'
import type { MapAdjustmentOperation, PrdTree } from '../../types/prdNode'

interface MapAdjustmentPanelProps {
  baseUrl: string
  tree: PrdTree
  onApply: (operations: MapAdjustmentOperation[]) => void
}

function operationLabel(operation: MapAdjustmentOperation) {
  if (operation.type === 'create_node') return `新增页面：${operation.title}`
  if (operation.type === 'delete_node') return `删除节点：${operation.nodeId}`
  if (operation.type === 'update_node') return `更新节点：${operation.nodeId}`
  if (operation.type === 'move_content') return `移动内容：${operation.fromNodeId} → ${operation.toNodeId}`
  return `添加引用：${operation.sourceNodeId} → ${operation.targetNodeId}`
}

export function MapAdjustmentPanel({ baseUrl, tree, onApply }: MapAdjustmentPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '如果页面拆分不合理，可以告诉我如何调整。我会先给出操作建议，确认后才会修改导图。' },
  ])
  const [draft, setDraft] = useState('')
  const [pendingOperations, setPendingOperations] = useState<MapAdjustmentOperation[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    const text = draft.trim()
    if (!text || isSending) return
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setDraft('')
    setError(null)
    setIsSending(true)
    try {
      const response = await requestMapAdjustment(baseUrl, nextMessages, tree)
      setMessages([...nextMessages, { role: 'assistant', content: response.reply }])
      setPendingOperations(response.operations)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 调整请求失败')
    } finally {
      setIsSending(false)
    }
  }

  function handleApply() {
    if (!pendingOperations.length) return
    onApply(pendingOperations)
    setPendingOperations([])
  }

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-outline-variant bg-surface-container-low">
      <div className="border-b border-outline-variant p-md">
        <div className="flex items-center gap-sm text-primary">
          <span className="material-symbols-outlined">auto_awesome</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface">AI 调整拆分</h2>
        </div>
        <p className="mt-xs text-body-sm text-on-surface-variant">先预览操作，再确认应用。</p>
      </div>

      <div className="custom-scrollbar flex-1 space-y-sm overflow-y-auto p-md">
        {messages.map((message, index) => (
          <div
            key={index}
            className={[
              'rounded-lg border p-sm text-body-sm leading-relaxed',
              message.role === 'user'
                ? 'border-primary/30 bg-primary-container/20 text-on-surface'
                : 'border-outline-variant bg-surface-container text-on-surface-variant',
            ].join(' ')}
          >
            {typeof message.content === 'string' ? message.content : '图片消息不用于导图调整'}
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
          placeholder="例如：把排行榜从主界面拆成独立页面"
          className="h-24 w-full resize-none rounded-lg border border-outline-variant bg-surface p-sm text-body-sm text-on-surface outline-none focus:border-primary"
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || isSending}
          className="mt-sm w-full rounded-lg bg-primary px-md py-sm text-label-md text-on-primary transition-opacity disabled:opacity-50"
        >
          {isSending ? '分析中...' : '生成调整建议'}
        </button>
      </div>
    </aside>
  )
}
