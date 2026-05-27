import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { ForgeChat } from '../components/map/ForgeChat'
import { ForgeNodePanel } from '../components/map/ForgeNodePanel'
import { sendNodeChatMessage } from '../lib/api'
import { useAppStore } from '../store/appStore'
import type { ChatMessage } from '../types/chat'

export function ForgePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const [, navigate] = useLocation()

  // Store reads — ForgePage is the sole Zustand reader (FORG-02)
  const prdTree = useAppStore((s) => s.prdTree)
  const nodeChats = useAppStore((s) => s.nodeChats)
  const settings = useAppStore((s) => s.settings)
  const appendNodeMessage = useAppStore((s) => s.appendNodeMessage)
  const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)

  // nodeComplete is local state — resets on navigation, NOT persisted (D-09)
  const [nodeComplete, setNodeComplete] = useState(false)

  const node = prdTree?.[nodeId ?? ''] ?? null
  const messages = nodeChats[nodeId ?? ''] ?? []

  // Auto-prepend welcome message on first mount (D-05)
  // Read from getState() to avoid StrictMode double-invoke (RESEARCH Pitfall 2)
  useEffect(() => {
    if (!nodeId || !node) return
    if ((useAppStore.getState().nodeChats[nodeId] ?? []).length > 0) return
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: `正在为节点 ${node.label}（${nodeId}）开启深度打磨。请告诉我这个节点最让你不清楚的交互细节，我们从那里开始。`,
    })
  }, [nodeId, node?.label]) // eslint-disable-line react-hooks/exhaustive-deps

  // handleSend — reads current messages from getState() to avoid stale closure (Pitfall 4)
  async function handleSend(text: string) {
    if (!nodeId || !prdTree || !node) return
    const userMsg: ChatMessage = { role: 'user', content: text }
    appendNodeMessage(nodeId, userMsg)
    const currentMessages = [...(useAppStore.getState().nodeChats[nodeId] ?? [])]
    try {
      const response = await sendNodeChatMessage(
        settings.proxyBaseUrl,
        nodeId,
        currentMessages,
        prdTree,
      )
      appendNodeMessage(nodeId, { role: 'assistant', content: response.reply })
      if (response.nodeComplete) setNodeComplete(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : '发送失败'
      appendNodeMessage(nodeId, { role: 'assistant', content: `请求失败：${message}` })
    }
  }

  // handleConfirm — D-11: updateNodeStatus then navigate to map
  function handleConfirm() {
    if (!nodeId) return
    updateNodeStatus(nodeId, 'done')
    navigate('/')
  }

  // Guard: no node → silent redirect
  if (!node) {
    navigate('/')
    return null
  }

  return (
    <div className="w-full h-screen flex flex-col bg-background">
      <header className="h-16 px-lg flex justify-between items-center bg-surface border-b border-outline-variant z-20 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-xs text-label-md text-on-surface-variant
            hover:text-on-surface transition-colors min-h-[44px]"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
          返回导图
        </button>

        <div className="flex items-center gap-sm">
          <span className="text-code-sm text-on-primary-container bg-primary-container rounded px-sm py-xs">
            {nodeId}
          </span>
          <span className="text-label-md text-on-surface truncate max-w-[320px]">
            {node.label}
          </span>
        </div>

        <button
          onClick={handleConfirm}
          className={[
            'flex items-center gap-xs rounded-lg px-md py-sm text-label-md transition-all min-h-[44px] border font-medium',
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
      </header>

      <main className="flex-1 flex overflow-hidden">
        <ForgeNodePanel node={node} />
        <ForgeChat
          nodeId={nodeId ?? ''}
          messages={messages}
          nodeComplete={nodeComplete}
          onSend={handleSend}
          onConfirm={handleConfirm}
          onBack={() => navigate('/')}
        />
      </main>
    </div>
  )
}
