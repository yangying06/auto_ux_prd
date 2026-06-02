import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { ForgeChat } from '../components/map/ForgeChat'
import { ForgeNodePanel } from '../components/map/ForgeNodePanel'
import { generatePrototype, sendNodeChatMessage, suggestPrdNodeOperations } from '../lib/api'
import { streamPrototype } from '../lib/prototypeStream'
import { useAppStore } from '../store/appStore'
import type { ChatMessage, ContentBlock } from '../types/chat'
import type { PrdNode } from '../types/prdNode'
import type { UXRequirementState } from '../types/uxRequirement'

const MAX_PROTOTYPE_IMAGES = 6

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

// Image blocks carry no role metadata; ForgeChat encodes the role in text lines like
// "1. 布局参考：name". We parse those lines to map each image (same order) to its role
// so reference images can be prioritized for prototype generation.
function isReferenceRoleLine(line: string) {
  return line.includes('布局参考')
}

function collectPrototypeImages(messages: ChatMessage[]): ContentBlock[] {
  const referenceImages: ContentBlock[] = []
  const otherImages: ContentBlock[] = []

  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content === 'string') continue

    const textBlock = message.content.find((block) => block.type === 'text')
    const roleLines = textBlock?.type === 'text'
      ? textBlock.text.split('\n').filter((line) => /^\s*\d+\.\s/.test(line))
      : []

    let imageIndex = 0
    for (const block of message.content) {
      if (block.type !== 'image' || !block.source) continue
      const roleLine = roleLines[imageIndex] ?? ''
      imageIndex += 1
      if (roleLine === '' || isReferenceRoleLine(roleLine)) {
        referenceImages.push(block)
      } else {
        otherImages.push(block)
      }
    }
  }

  return [...referenceImages, ...otherImages].slice(0, MAX_PROTOTYPE_IMAGES)
}

function buildMvcChildContext(node: PrdNode, tree: Record<string, PrdNode> | null) {
  const children = node.children.map((childId) => tree?.[childId]).filter((child): child is PrdNode => Boolean(child))
  if (!children.length) return null
  return [
    '页面下属 MVC 子节点上下文：',
    ...children.map((child) => [
      `- ${child.label}（${child.id} / ${child.type}）`,
      `  摘要：${child.summary}`,
      `  内容：${child.content}`,
      child.techNotes ? `  技术备注：${child.techNotes}` : null,
      child.docPath ? `  文档路径：${child.docPath}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n')
}

function buildNodePrototypeRequirement(node: PrdNode, messages: ChatMessage[], tree: Record<string, PrdNode> | null): UXRequirementState {
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
  const mvcChildContext = node.type === 'page' ? buildMvcChildContext(node, tree) : null

  return {
    trigger_condition: `基于 PRD 节点 ${node.id}「${node.label}」生成手机端交互原型。`,
    sequence_rules: [
      stripPolishSection(node.content),
      mvcChildContext,
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
  const nodeOperationSuggestions = useAppStore((s) => s.nodeOperationSuggestions)
  const settings = useAppStore((s) => s.settings)
  const appendNodeMessage = useAppStore((s) => s.appendNodeMessage)
  const clearNodeChat = useAppStore((s) => s.clearNodeChat)
  const setNodeOperationSuggestions = useAppStore((s) => s.setNodeOperationSuggestions)
  const applyNodeOperationSuggestion = useAppStore((s) => s.applyNodeOperationSuggestion)
  const dismissNodeOperationSuggestion = useAppStore((s) => s.dismissNodeOperationSuggestion)
  const applyNodePolish = useAppStore((s) => s.applyNodePolish)
  const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)
  const prototypeHtml = useAppStore((s) => s.prototypeHtml)
  const prototypeHistory = useAppStore((s) => s.prototypeHistory)
  const recordPrototypeHistory = useAppStore((s) => s.recordPrototypeHistory)
  const restorePrototypeVersion = useAppStore((s) => s.restorePrototypeVersion)
  const clearPrototypeHistory = useAppStore((s) => s.clearPrototypeHistory)
  const setPrototypeVariants = useAppStore((s) => s.setPrototypeVariants)
  const updatePrototypeVariant = useAppStore((s) => s.updatePrototypeVariant)
  const selectPrototypeVariant = useAppStore((s) => s.selectPrototypeVariant)
  const prototypeVariants = useAppStore((s) => s.prototypeVariants)
  const selectedVariantIndex = useAppStore((s) => s.selectedVariantIndex)

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
      if (response.nodeComplete) {
        setNodeComplete(true)
        updateNodeStatus(nodeId, 'done')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '发送失败'
      appendNodeMessage(nodeId, { role: 'assistant', content: `请求失败：${message}` })
      throw err
    }
  }

  async function handleSuggestNodeOperations(input: { supplementText: string; sources: Array<{ name: string; sourceKind: 'upload'; text: string }> }) {
    if (!nodeId || !prdTree || !node) return
    const response = await suggestPrdNodeOperations(settings.proxyBaseUrl, {
      tree: prdTree,
      selectedNodeId: nodeId,
      supplementText: input.supplementText,
      sources: input.sources.map((source) => ({ name: source.name, sourceKind: source.sourceKind, text: source.text })),
    })
    setNodeOperationSuggestions(nodeId, response.suggestions)
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: response.suggestions.length
        ? `${response.reply}\n\n已生成 ${response.suggestions.length} 条待确认节点建议，请在输入框上方逐条应用或忽略。`
        : response.reply,
    })
  }

  async function handleGeneratePrototype(instruction?: string) {
    if (!node) return
    const trimmedInstruction = instruction?.trim() ?? ''
    const currentMessages = nodeId ? (useAppStore.getState().nodeChats[nodeId] ?? messages) : messages
    const currentNode = nodeId ? (useAppStore.getState().prdTree?.[nodeId] ?? node) : node
    const referenceImages = collectPrototypeImages(currentMessages)
    const currentStore = useAppStore.getState()
    const requirementState = buildNodePrototypeRequirement(currentNode, currentMessages, currentStore.prdTree)
    const selectedVariant = currentStore.prototypeVariants.find((variant) => variant.index === currentStore.selectedVariantIndex)
    const isUpdate = Boolean(trimmedInstruction && selectedVariant?.html)

    setIsGeneratingPrototype(true)
    try {
      if (isUpdate && selectedVariant?.html) {
        recordPrototypeHistory(selectedVariant.html, { mode: 'update', note: `修改前：${trimmedInstruction}` })
        updatePrototypeVariant(selectedVariant.index, { status: 'streaming' })
        await streamPrototype(
          settings.proxyBaseUrl,
          requirementState,
          {
            currentHtml: selectedVariant.html,
            instruction: trimmedInstruction,
            images: referenceImages,
            numVariants: 1,
            variantIndex: selectedVariant.index,
            history: selectedVariant.history ?? [],
          },
          (event) => {
            if (event.type === 'setCode') {
              updatePrototypeVariant(event.variantIndex, {
                html: event.html,
                status: 'streaming',
                focus: event.focus,
                history: event.history,
              })
              if (event.variantIndex === selectedVariant.index && event.html) selectPrototypeVariant(event.variantIndex)
            } else if (event.type === 'variantComplete') {
              updatePrototypeVariant(event.variantIndex, {
                html: event.html,
                status: 'complete',
                focus: event.focus,
                history: event.history,
              })
              if (event.variantIndex === selectedVariant.index && event.html) selectPrototypeVariant(event.variantIndex)
            } else if (event.type === 'variantError') {
              updatePrototypeVariant(event.variantIndex, { status: 'error', focus: event.focus })
            }
          },
        )
        selectPrototypeVariant(selectedVariant.index)
        return
      }

      setPrototypeVariants(Array.from({ length: 4 }, (_, index) => ({ index, html: null, status: 'streaming' as const })))
      await streamPrototype(
        settings.proxyBaseUrl,
        requirementState,
        { images: referenceImages, numVariants: 4 },
        (event) => {
          if (event.type === 'setCode') {
            updatePrototypeVariant(event.variantIndex, {
              html: event.html,
              status: 'streaming',
              focus: event.focus,
              history: event.history,
            })
          } else if (event.type === 'variantComplete') {
            updatePrototypeVariant(event.variantIndex, {
              html: event.html,
              status: 'complete',
              focus: event.focus,
              history: event.history,
            })
            if (event.html && useAppStore.getState().selectedVariantIndex === -1) {
              selectPrototypeVariant(event.variantIndex)
            }
          } else if (event.type === 'variantError') {
            updatePrototypeVariant(event.variantIndex, { status: 'error', focus: event.focus })
          }
        },
      )
    } catch {
      const result = await generatePrototype(
        settings.proxyBaseUrl,
        requirementState,
        {
          currentHtml: isUpdate ? selectedVariant?.html : null,
          instruction: trimmedInstruction || undefined,
          images: referenceImages,
          numVariants: isUpdate ? 1 : 4,
          variantIndex: isUpdate ? selectedVariant?.index : undefined,
          history: isUpdate ? selectedVariant?.history : undefined,
        },
      )

      if (isUpdate && selectedVariant) {
        const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html) ?? result.variants[0]
        if (chosen?.html) {
          updatePrototypeVariant(selectedVariant.index, {
            html: chosen.html,
            status: 'complete',
            focus: chosen.focus,
            history: chosen.history,
          })
          selectPrototypeVariant(selectedVariant.index)
        }
      } else {
        setPrototypeVariants(result.variants.map((variant) => ({
          index: variant.index,
          html: variant.html,
          status: variant.status,
          focus: variant.focus,
          history: variant.history,
        })))
        const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html)
        if (chosen?.html) {
          selectPrototypeVariant(chosen.index)
        }
      }
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
          prototypeVariants={prototypeVariants}
          selectedVariantIndex={selectedVariantIndex}
          isGeneratingPrototype={isGeneratingPrototype}
          nodeOperationSuggestions={nodeOperationSuggestions[nodeId] ?? []}
          onSend={handleSend}
          onSuggestNodeOperations={handleSuggestNodeOperations}
          onApplyNodeOperationSuggestion={(suggestionId) => applyNodeOperationSuggestion(nodeId, suggestionId)}
          onDismissNodeOperationSuggestion={(suggestionId) => dismissNodeOperationSuggestion(nodeId, suggestionId)}
          onConfirm={handleConfirm}
          onBack={() => navigate('/')}
          onGeneratePrototype={handleGeneratePrototype}
          onRestorePrototype={restorePrototypeVersion}
          onClearPrototypeHistory={clearPrototypeHistory}
          onSelectVariant={selectPrototypeVariant}
          onClearChat={() => clearNodeChat(nodeId)}
        />
      </main>
    </div>
  )
}
