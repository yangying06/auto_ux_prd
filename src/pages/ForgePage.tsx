import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { ForgeChat } from '../components/map/ForgeChat'
import { ForgeNodePanel } from '../components/map/ForgeNodePanel'
import { classifyReferenceImage, generatePrototype, importFigmaFrame, sendNodeChatMessage, suggestPrdNodeOperations } from '../lib/api'
import { formatPerformanceSpecForPrompt, resolveNodePerformanceSpec } from '../lib/performanceOrchestration'
import { formatSectionTitle, formatSpecLens, hasNodeSections, resolveNodeSpecLens } from '../lib/prdNodeLens'
import { streamPrototype } from '../lib/prototypeStream'
import { useAppStore } from '../store/appStore'
import type { ChatMessage, ContentBlock, ReferenceImageClassificationRequest } from '../types/chat'
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
  return line.includes('layout_reference') || line.includes('布局参考')
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
      `- ${child.label}（${child.id} / ${child.type} / ${formatSpecLens(resolveNodeSpecLens(child))}）`,
      `  摘要：${child.summary}`,
      `  内容：${child.content}`,
      child.techNotes ? `  技术备注：${child.techNotes}` : null,
      child.docPath ? `  文档路径：${child.docPath}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n')
}

function buildPageSectionContext(node: PrdNode) {
  if (!hasNodeSections(node.sections)) return null
  return [
    '页面内规格视角：',
    ...(['view', 'interaction', 'data'] as const).map((key) => {
      const section = node.sections?.[key]
      if (!section?.summary && !section?.content) return null
      return [
        `## ${section.title ?? formatSectionTitle(key)}`,
        section.summary ? `摘要：${section.summary}` : null,
        section.content ? `内容：${section.content}` : null,
      ].filter(Boolean).join('\n')
    }).filter((item): item is string => Boolean(item)),
  ].join('\n\n')
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
  const pageSectionContext = buildPageSectionContext(node)
  const performanceSpec = resolveNodePerformanceSpec(node)
  const performanceContext = performanceSpec?.detected && !performanceSpec.disabled
    ? `表现编排规格：\n${formatPerformanceSpecForPrompt(performanceSpec)}`
    : null
  const performanceAssets = performanceSpec?.detected && !performanceSpec.disabled
    ? performanceSpec.assets.map((asset) => ({
        type: 'PerformanceAsset',
        path: asset,
        is_ready: false,
      }))
    : []

  return {
    trigger_condition: `基于 PRD 节点 ${node.id}「${node.label}」生成手机端交互原型。`,
    sequence_rules: [
      stripPolishSection(node.content),
      pageSectionContext,
      mvcChildContext,
      performanceContext,
      transcript ? `\nDeep Forge 对话摘要：\n${transcript}` : null,
    ].filter(Boolean).join('\n\n'),
    asset_dependencies: referenceCount > 0
      ? [
          ...Array.from({ length: referenceCount }, (_, index) => ({
            type: 'ReferenceImage',
            path: `当前节点对话中的参考图 ${index + 1}`,
            is_ready: true,
          })),
          ...performanceAssets,
        ]
      : performanceAssets,
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
    performance_spec: performanceSpec?.detected && !performanceSpec.disabled ? performanceSpec : null,
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
  const nodePrototypeState = useAppStore((s) => nodeId ? s.nodePrototypeStates[nodeId] : undefined)
  const prototypeHtml = nodePrototypeState?.prototypeHtml ?? null
  const prototypeHistory = nodePrototypeState?.prototypeHistory ?? []
  const prototypeVariants = nodePrototypeState?.prototypeVariants ?? []
  const selectedVariantIndex = nodePrototypeState?.selectedVariantIndex ?? -1
  const setNodePrototypeHtml = useAppStore((s) => s.setNodePrototypeHtml)
  const recordNodePrototypeHistory = useAppStore((s) => s.recordNodePrototypeHistory)
  const restoreNodePrototypeVersion = useAppStore((s) => s.restoreNodePrototypeVersion)
  const clearNodePrototypeHistory = useAppStore((s) => s.clearNodePrototypeHistory)
  const setNodePrototypeVariants = useAppStore((s) => s.setNodePrototypeVariants)
  const updateNodePrototypeVariant = useAppStore((s) => s.updateNodePrototypeVariant)
  const selectNodePrototypeVariant = useAppStore((s) => s.selectNodePrototypeVariant)

  const [nodeComplete, setNodeComplete] = useState(false)
  const [isGeneratingPrototype, setIsGeneratingPrototype] = useState(false)

  const node = prdTree?.[nodeId ?? ''] ?? null
  const messages = nodeChats[nodeId ?? ''] ?? []
  const performanceSpec = node ? resolveNodePerformanceSpec(node) : null
  const hasPerformanceRisk = Boolean(
    nodeComplete
    && performanceSpec?.detected
    && !performanceSpec.disabled
    && performanceSpec.readiness
    && performanceSpec.readiness.level !== 'ready'
    && performanceSpec.readiness.level !== 'waived',
  )

  useEffect(() => {
    if (!node && nodeId) navigate('/')
  }, [node, nodeId, navigate])

  useEffect(() => {
    setNodeComplete(node?.status === 'done')
  }, [nodeId, node?.status])

  useEffect(() => {
    if (!nodeId || !node) return
    if ((useAppStore.getState().nodeChats[nodeId] ?? []).length > 0) return
    const performanceSpec = resolveNodePerformanceSpec(node)
    const visualPrompt = prototypeHtml
      ? '我看到右侧已有原型预览，会先基于现有原型确认界面结构和主流程。'
      : '第一步请先上传原型截图、参考图，或粘贴 Figma 链接导入视觉稿；如果暂时没有，请直接说“没有原型资源，先按文字打磨”。'
    const performanceIntro = performanceSpec?.detected && !performanceSpec.disabled
      ? [
          '',
          `后续我也会处理表现编排：${performanceSpec.eventTypes.join('、') || '表现流程'}。`,
          '但顺序会放在原型/视觉依据和核心流程确认之后，再追问触发、分支、顺序、资源、层级、控制和结束状态。',
        ].filter(Boolean).join('\n')
      : ''
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: `正在为文档包 ${node.label}（${node.docPath ?? nodeId}）开启深度打磨。\n${visualPrompt}\n之后我会确认入口、主流程、状态/边界、依赖字段和验收标准。${performanceIntro}`,
    })
  }, [appendNodeMessage, node, nodeId, prototypeHtml])

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
      const prototypeInstruction = response.prototypeInstruction?.trim()
      if (prototypeInstruction) {
        try {
          await handleGeneratePrototype(prototypeInstruction, { recordInstruction: false, singlePrototypeOnly: true })
          appendNodeMessage(nodeId, { role: 'assistant', content: '已根据同一轮输入同步更新右侧原型预览。' })
        } catch (err) {
          const message = err instanceof Error ? err.message : '原型更新失败'
          appendNodeMessage(nodeId, { role: 'assistant', content: `文档打磨已完成，但右侧原型同步更新失败：${message}` })
        }
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

  function handleClassifyImageAttachment(input: ReferenceImageClassificationRequest) {
    return classifyReferenceImage(settings.proxyBaseUrl, input)
  }

  async function handleImportFigmaFrame(input: { url: string }) {
    if (!nodeId) throw new Error('当前没有选中的节点。')
    const result = await importFigmaFrame(settings.proxyBaseUrl, input)
    setNodePrototypeHtml(nodeId, result.html, { mode: 'create', note: `Figma2Prefab：${result.panelName}` })
    setNodePrototypeVariants(nodeId, [{
      index: 0,
      html: result.html,
      status: 'complete',
      focus: `Figma2Prefab ${result.panelName}`,
      history: [`从 ${result.sourceUrl} 导入 ${result.uiSpecPath}`],
    }])
    selectNodePrototypeVariant(nodeId, 0)
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: `${result.summary}\n\n已把生成的 HTML 放到右侧原型预览，可继续用“按对话更新”迭代。`,
    })
    return result
  }

  async function handleGeneratePrototype(instruction?: string, options?: { singlePrototypeOnly?: boolean; recordInstruction?: boolean; evidenceContent?: ChatMessage['content'] }) {
    if (!node) return
    const trimmedInstruction = instruction?.trim() ?? ''
    const shouldRecordInstruction = Boolean(options?.recordInstruction && trimmedInstruction && nodeId)
    let prototypeCompleted = false
    if (shouldRecordInstruction) {
      appendNodeMessage(nodeId, { role: 'user', content: `原型修改：${trimmedInstruction}` })
    }
    const currentMessages = nodeId ? (useAppStore.getState().nodeChats[nodeId] ?? messages) : messages
    const evidenceMessages = options?.evidenceContent
      ? [...currentMessages, { role: 'user' as const, content: options.evidenceContent }]
      : currentMessages
    const currentNode = nodeId ? (useAppStore.getState().prdTree?.[nodeId] ?? node) : node
    const referenceImages = collectPrototypeImages(evidenceMessages)
    const currentStore = useAppStore.getState()
    const requirementState = buildNodePrototypeRequirement(currentNode, evidenceMessages, currentStore.prdTree)
    const currentPrototypeState = currentStore.nodePrototypeStates[nodeId ?? '']
    const selectedVariant = currentPrototypeState?.prototypeVariants.find((variant) => variant.index === currentPrototypeState?.selectedVariantIndex)
    const selectedPrototypeHtml = selectedVariant?.html ?? currentPrototypeState?.prototypeHtml ?? null
    const isUpdate = Boolean(trimmedInstruction && selectedPrototypeHtml)
    const createVariantCount = options?.singlePrototypeOnly ? 1 : 2

    setIsGeneratingPrototype(true)
    try {
      if (isUpdate && selectedVariant?.html) {
        recordNodePrototypeHistory(nodeId, selectedVariant.html, { mode: 'update', note: `修改前：${trimmedInstruction}` })
        updateNodePrototypeVariant(nodeId, selectedVariant.index, { status: 'streaming' })
        let didReceivePrototypeHtml = false
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
              if (event.html) didReceivePrototypeHtml = true
              updateNodePrototypeVariant(nodeId, event.variantIndex, {
                html: event.html,
                status: 'streaming',
                focus: event.focus,
                history: event.history,
              })
              if (event.variantIndex === selectedVariant.index && event.html) selectNodePrototypeVariant(nodeId, event.variantIndex)
            } else if (event.type === 'variantComplete') {
              if (event.html) didReceivePrototypeHtml = true
              updateNodePrototypeVariant(nodeId, event.variantIndex, {
                html: event.html,
                status: 'complete',
                focus: event.focus,
                history: event.history,
              })
              if (event.variantIndex === selectedVariant.index && event.html) selectNodePrototypeVariant(nodeId, event.variantIndex)
            } else if (event.type === 'variantError') {
              updateNodePrototypeVariant(nodeId, event.variantIndex, { status: 'error', focus: event.focus })
            }
          },
        )
        selectNodePrototypeVariant(nodeId, selectedVariant.index)
        prototypeCompleted = didReceivePrototypeHtml
        return
      }

      if (isUpdate && selectedPrototypeHtml) {
        throw new Error('fallback to non-streaming prototype update')
      }

      setNodePrototypeVariants(nodeId, Array.from({ length: createVariantCount }, (_, index) => ({ index, html: null, status: 'streaming' as const })))
      let didReceivePrototypeHtml = false
      await streamPrototype(
        settings.proxyBaseUrl,
        requirementState,
        { images: referenceImages, numVariants: createVariantCount },
        (event) => {
          if (event.type === 'setCode') {
            if (event.html) didReceivePrototypeHtml = true
            updateNodePrototypeVariant(nodeId, event.variantIndex, {
              html: event.html,
              status: 'streaming',
              focus: event.focus,
              history: event.history,
            })
          } else if (event.type === 'variantComplete') {
            if (event.html) didReceivePrototypeHtml = true
            updateNodePrototypeVariant(nodeId, event.variantIndex, {
              html: event.html,
              status: 'complete',
              focus: event.focus,
              history: event.history,
            })
            if (event.html && useAppStore.getState().nodePrototypeStates[nodeId]?.selectedVariantIndex === -1) {
              selectNodePrototypeVariant(nodeId, event.variantIndex)
            }
          } else if (event.type === 'variantError') {
            updateNodePrototypeVariant(nodeId, event.variantIndex, { status: 'error', focus: event.focus })
          }
        },
      )
      prototypeCompleted = didReceivePrototypeHtml
    } catch {
      const result = await generatePrototype(
        settings.proxyBaseUrl,
        requirementState,
        {
          currentHtml: isUpdate ? selectedPrototypeHtml : null,
          instruction: trimmedInstruction || undefined,
          images: referenceImages,
          numVariants: isUpdate ? 1 : createVariantCount,
          variantIndex: isUpdate ? selectedVariant?.index : undefined,
          history: isUpdate ? selectedVariant?.history : undefined,
        },
      )

      if (isUpdate && selectedVariant) {
        const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html) ?? result.variants[0]
        if (chosen?.html) {
          updateNodePrototypeVariant(nodeId, selectedVariant.index, {
            html: chosen.html,
            status: 'complete',
            focus: chosen.focus,
            history: chosen.history,
          })
          selectNodePrototypeVariant(nodeId, selectedVariant.index)
          prototypeCompleted = true
        }
      } else if (isUpdate) {
        const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html) ?? result.variants[0]
        if (chosen?.html) {
          setNodePrototypeHtml(nodeId, chosen.html, { mode: 'update', note: `按对话更新：${trimmedInstruction}` })
          prototypeCompleted = true
        }
      } else {
        setNodePrototypeVariants(nodeId, result.variants.map((variant) => ({
          index: variant.index,
          html: variant.html,
          status: variant.status,
          focus: variant.focus,
          history: variant.history,
        })))
        const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html)
        if (chosen?.html) {
          selectNodePrototypeVariant(nodeId, chosen.index)
          prototypeCompleted = true
        }
      }
    } finally {
      if (shouldRecordInstruction && prototypeCompleted) {
        appendNodeMessage(nodeId, { role: 'assistant', content: '已更新右侧原型预览。' })
      }
      setIsGeneratingPrototype(false)
    }
  }

  function handleConfirm() {
    if (!nodeId || !node) return
    if (node.status === 'done') {
      updateNodeStatus(nodeId, 'pending_refine')
      setNodeComplete(false)
      return
    }
    const currentState = useAppStore.getState()
    const currentNode = currentState.prdTree?.[nodeId] ?? node
    if (!POLISH_SECTION_RE.test(currentNode.content)) {
      applyNodePolish(nodeId, buildFallbackPolish(currentNode, currentState.nodeChats[nodeId] ?? []))
    }
    updateNodeStatus(nodeId, 'done')
    setNodeComplete(true)
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
          aria-pressed={nodeComplete}
          className={[
            'flex min-h-[44px] items-center gap-xs rounded-lg border px-md py-sm text-label-md font-medium transition-all',
            nodeComplete && !hasPerformanceRisk
              ? 'border-tertiary bg-tertiary-container text-on-tertiary-container active-glow'
              : hasPerformanceRisk
                ? 'border-secondary bg-secondary-container text-on-secondary-container'
                : 'border-outline-variant bg-secondary-container text-on-secondary-container',
          ].join(' ')}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: '16px',
              fontVariationSettings: nodeComplete ? "'FILL' 1" : "'FILL' 0",
            }}
          >
            {nodeComplete ? hasPerformanceRisk ? 'warning' : 'check_circle' : 'auto_awesome'}
          </span>
          {nodeComplete ? hasPerformanceRisk ? '已完成 · 表现风险' : '已完成' : '待打磨'}
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
          onClassifyImageAttachment={handleClassifyImageAttachment}
          onImportFigmaFrame={handleImportFigmaFrame}
          onApplyNodeOperationSuggestion={(suggestionId) => applyNodeOperationSuggestion(nodeId, suggestionId)}
          onDismissNodeOperationSuggestion={(suggestionId) => dismissNodeOperationSuggestion(nodeId, suggestionId)}
          onGeneratePrototype={handleGeneratePrototype}
          onRestorePrototype={(id) => restoreNodePrototypeVersion(nodeId, id)}
          onClearPrototypeHistory={() => clearNodePrototypeHistory(nodeId)}
          onSelectVariant={(index) => selectNodePrototypeVariant(nodeId, index)}
          onClearChat={() => clearNodeChat(nodeId)}
        />
      </main>
    </div>
  )
}
