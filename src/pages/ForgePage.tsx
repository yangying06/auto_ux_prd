import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { ForgeChat } from '../components/map/ForgeChat'
import { ForgeNodePanel } from '../components/map/ForgeNodePanel'
import { generatePrototype, sendNodeChatMessage } from '../lib/api'
import { useAppStore } from '../store/appStore'
import type { ChatMessage } from '../types/chat'
import type { PrdNode } from '../types/prdNode'
import type { UXRequirementState } from '../types/uxRequirement'

type NodePolishPatch = NonNullable<Awaited<ReturnType<typeof sendNodeChatMessage>>['nodePatch']>

const POLISH_SECTION_RE = /\n\n## Deep Forge (?:精修规格|精修文档|打磨记录)\n[\s\S]*$/u

function contentText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content.trim()
  return content
    .map((block) => block.type === 'text' ? block.text.trim() : `[图片附件: ${block.source.media_type}]`)
    .filter(Boolean)
    .join('\n')
}

function stripPolishSection(content: string) {
  return content.replace(POLISH_SECTION_RE, '').trim()
}

function mergePolishPatch(node: PrdNode, patch: NodePolishPatch) {
  const next: NodePolishPatch = { ...patch }
  if (patch.content?.trim()) {
    const baseContent = stripPolishSection(node.content)
    next.content = `${baseContent}\n\n## Deep Forge 精修文档\n${patch.content.trim()}`
  }
  return next
}

function buildFallbackPolish(node: PrdNode, messages: ChatMessage[]): NodePolishPatch {
  const transcript = messages
    .map((message) => {
      const text = contentText(message.content)
      if (!text) return null
      return `**${message.role === 'user' ? '用户' : 'AI'}**\n${text}`
    })
    .filter((item): item is string => Boolean(item))
    .join('\n\n')

  const baseContent = stripPolishSection(node.content)
  return {
    content: `${baseContent}\n\n## Deep Forge 打磨记录\n${transcript || '用户已人工确认该文档包。'}`,
    techNotes: [
      node.techNotes,
      'Deep Forge 已人工确认，打磨记录已合并到文档包。',
    ].filter(Boolean).join('\n\n'),
  }
}

function countImageBlocks(messages: ChatMessage[]) {
  return messages.reduce((sum, message) => {
    if (typeof message.content === 'string') return sum
    return sum + message.content.filter((block) => block.type === 'image').length
  }, 0)
}

function buildNodePrototypeRequirement(node: PrdNode, messages: ChatMessage[]): UXRequirementState {
  const transcript = messages
    .slice(-12)
    .map((message) => {
      const text = contentText(message.content)
      if (!text) return null
      return `${message.role === 'user' ? '用户' : 'AI'}：${text}`
    })
    .filter((item): item is string => Boolean(item))
    .join('\n')
  const referenceCount = countImageBlocks(messages)

  return {
    trigger_condition: `基于 PRD 节点 ${node.id}「${node.label}」生成手机端交互原型。`,
    sequence_rules: [
      stripPolishSection(node.content),
      transcript ? `\nDeep Forge 对话摘要：\n${transcript}` : null,
    ].filter(Boolean).join('\n\n'),
    asset_dependencies: referenceCount > 0
      ? Array.from({ length: referenceCount }, (_, index) => ({
          type: 'ReferenceImage',
          path: `当前节点对话中的参考图 ${index + 1}`,
          is_ready: true,
        }))
      : [],
    engine_constraints: node.techNotes ?? '面向 Cocos Creator 游戏 UI，还原移动端长屏界面和关键交互状态。',
    ui_components: [],
    suggested_answers: [],
    completion_rate: node.status === 'done' ? 85 : 68,
    slot_confidence: {
      trigger_condition: 80,
      sequence_rules: 72,
      asset_dependencies: referenceCount > 0 ? 70 : 40,
      engine_constraints: node.techNotes ? 70 : 50,
    },
    missing_reasons: {
      trigger_condition: null,
      sequence_rules: null,
      asset_dependencies: referenceCount > 0 ? null : '可上传参考图提升原型贴合度。',
      engine_constraints: null,
    },
    next_question: null,
  }
}

export function ForgePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const [, navigate] = useLocation()

  const prdTree = useAppStore((s) => s.prdTree)
  const nodeChats = useAppStore((s) => s.nodeChats)
  const settings = useAppStore((s) => s.settings)
  const appendNodeMessage = useAppStore((s) => s.appendNodeMessage)
  const applyNodePolish = useAppStore((s) => s.applyNodePolish)
  const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)
  const prototypeHtml = useAppStore((s) => s.prototypeHtml)
  const prototypeHistory = useAppStore((s) => s.prototypeHistory)
  const setPrototypeHtml = useAppStore((s) => s.setPrototypeHtml)
  const restorePrototypeVersion = useAppStore((s) => s.restorePrototypeVersion)

  const [nodeComplete, setNodeComplete] = useState(false)
  const [isGeneratingPrototype, setIsGeneratingPrototype] = useState(false)

  const node = prdTree?.[nodeId ?? ''] ?? null
  const messages = nodeChats[nodeId ?? ''] ?? []

  useEffect(() => {
    if (!node && nodeId) navigate('/')
  }, [node, nodeId, navigate])

  useEffect(() => {
    setNodeComplete(node?.status === 'done')
  }, [nodeId, node?.status])

  useEffect(() => {
    if (!nodeId || !node) return
    if ((useAppStore.getState().nodeChats[nodeId] ?? []).length > 0) return
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: `正在为文档包 ${node.label}（${node.docPath ?? nodeId}）开启深度打磨。可以补充原文依据、职责边界、依赖字段、验收标准；如果这是客户端/UI 文档，也可以上传参考图来对齐布局和状态反馈。`,
    })
  }, [appendNodeMessage, node, nodeId])

  async function handleSend(content: ChatMessage['content']) {
    if (!nodeId || !prdTree || !node) return
    const userMsg: ChatMessage = { role: 'user', content }
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
      if (response.nodePatch) {
        const currentNode = useAppStore.getState().prdTree?.[nodeId] ?? node
        applyNodePolish(nodeId, mergePolishPatch(currentNode, response.nodePatch))
      }
      if (response.nodeComplete) setNodeComplete(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : '发送失败'
      appendNodeMessage(nodeId, { role: 'assistant', content: `请求失败：${message}` })
      throw err
    }
  }

  async function handleGeneratePrototype(instruction?: string) {
    if (!node) return
    const trimmedInstruction = instruction?.trim() ?? ''
    const currentMessages = nodeId ? (useAppStore.getState().nodeChats[nodeId] ?? messages) : messages
    const currentNode = nodeId ? (useAppStore.getState().prdTree?.[nodeId] ?? node) : node

    setIsGeneratingPrototype(true)
    try {
      const result = await generatePrototype(
        settings.proxyBaseUrl,
        buildNodePrototypeRequirement(currentNode, currentMessages),
        {
          currentHtml: trimmedInstruction ? prototypeHtml : null,
          instruction: trimmedInstruction || undefined,
        },
      )
      setPrototypeHtml(result.html, {
        mode: result.mode === 'create' ? 'create' : 'update',
        note: trimmedInstruction || `节点 ${currentNode.id} 原型`,
      })
    } finally {
      setIsGeneratingPrototype(false)
    }
  }

  function handleConfirm() {
    if (!nodeId || !node) return
    const currentState = useAppStore.getState()
    const currentNode = currentState.prdTree?.[nodeId] ?? node
    if (!POLISH_SECTION_RE.test(currentNode.content)) {
      applyNodePolish(nodeId, buildFallbackPolish(currentNode, currentState.nodeChats[nodeId] ?? []))
    }
    updateNodeStatus(nodeId, 'done')
    navigate('/')
  }

  if (!node || !nodeId) return null

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-lg">
        <button
          onClick={() => navigate('/')}
          className="flex min-h-[44px] items-center gap-xs text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            arrow_back
          </span>
          返回导图
        </button>

        <div className="flex min-w-0 items-center gap-sm">
          <span className="rounded bg-primary-container px-sm py-xs text-code-sm text-on-primary-container">
            {nodeId}
          </span>
          <span className="max-w-[420px] truncate text-label-md text-on-surface">
            {node.label}
          </span>
        </div>

        <button
          onClick={handleConfirm}
          className={[
            'flex min-h-[44px] items-center gap-xs rounded-lg border px-md py-sm text-label-md font-medium transition-all',
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
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <ForgeNodePanel node={node} />
        <ForgeChat
          nodeId={nodeId}
          messages={messages}
          nodeComplete={nodeComplete}
          prototypeHtml={prototypeHtml}
          prototypeHistory={prototypeHistory}
          isGeneratingPrototype={isGeneratingPrototype}
          onSend={handleSend}
          onConfirm={handleConfirm}
          onBack={() => navigate('/')}
          onGeneratePrototype={handleGeneratePrototype}
          onRestorePrototype={restorePrototypeVersion}
        />
      </main>
    </div>
  )
}
