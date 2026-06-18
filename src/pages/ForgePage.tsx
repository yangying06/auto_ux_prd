import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { ForgeChat } from '../components/map/ForgeChat'
import { ForgeNodePanel } from '../components/map/ForgeNodePanel'
import { AssetWorkbenchModal } from '../components/map/AssetWorkbenchModal'
import { classifyReferenceImage, generatePrototype, importFigmaFrame, sendNodeChatMessage } from '../lib/api'
import { formatPerformanceSpecForPrompt, resolveNodePerformanceSpec } from '../lib/performanceOrchestration'
import { formatSectionTitle, formatSpecLens, hasNodeSections, resolveNodeSpecLens } from '../lib/prdNodeLens'
import { buildDeliverySections, collectBackendContracts, isDeliveryNode } from '../lib/prdNodeDelivery'
import { streamPrototype } from '../lib/prototypeStream'
import { buildUiOnlyPrototypeInstruction, chatContentImages, chatContentText, extractFigmaUrlsFromText, isUiOnlyPrototypeFeedback } from '../lib/nodeChatIntent'
import { buildFigmaPrototypeIterationInstruction, mergeInstructionIntoPrototypeEvidence } from '../lib/prototypeIteration'
import { useAppStore } from '../store/appStore'
import type { FigmaFrameImportResponse, NodeChatOptions } from '../lib/api'
import type { AssetWorkbenchState } from '../types/assetWorkbench'
import type { ChatMessage, ContentBlock, ReferenceImageClassificationRequest } from '../types/chat'
import type { PrdNode } from '../types/prdNode'
import type { PrototypeAssetManifest, PrototypeGenerationMode, PrototypeInterfaceBlueprint } from '../types/prototypeAssets'
import type { AssetDependency, UXRequirementState } from '../types/uxRequirement'

const MAX_PROTOTYPE_IMAGES = 6

type NodePolishPatch = NonNullable<Awaited<ReturnType<typeof sendNodeChatMessage>>['nodePatch']>
type ForgeSendOptions = NodeChatOptions & { suppressUserEcho?: boolean; generationMode?: PrototypeGenerationMode }
type ForgePrototypeOptions = {
  singlePrototypeOnly?: boolean
  recordInstruction?: boolean
  evidenceContent?: ChatMessage['content']
  currentTurnOnly?: boolean
  generationMode?: PrototypeGenerationMode
  preferredInterfaceAssetId?: string | null
  forceInterfaceBase?: boolean
}

const POLISH_SECTION_RE = /\n\n## Deep Forge .*\n[\s\S]*$/u

function errorMessageFromUnknown(error: unknown, fallback = 'Prototype update failed.') {
  return error instanceof Error && error.message ? error.message : fallback
}

function isAbortError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && String((error as { name?: unknown }).name) === 'AbortError'
}

function prototypeGenerationCancelledError() {
  return new DOMException('已取消原型生成。', 'AbortError')
}

function contentText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content.trim()
  return content
    .map((block) => {
      if (block.type === 'text') return block.text.trim()
      if (block.type === 'document') return `[Document attachment: ${block.title}]`
      return `[图片附件: ${block.source.media_type}]`
    })
    .filter(Boolean)
    .join('\n')
}

function stripPolishSection(content: string) {
  return content.replace(POLISH_SECTION_RE, '').trim()
}

function mergePolishPatch(patch: NodePolishPatch) {
  const next: NodePolishPatch = { ...patch }
  const content = patch.content?.trim()
  if (content) {
    next.content = stripPolishSection(content)
  }
  return next
}

function formatNodeChatStatus(documentUpdated: boolean, prototypeUpdated: boolean, fallback: string) {
  if (documentUpdated && prototypeUpdated) return 'Recorded this requirement and completed this UI iteration.'
  if (prototypeUpdated) return 'Completed this UI iteration.'
  if (documentUpdated) return 'Recorded this requirement.'
  const trimmed = fallback.trim()
  return trimmed.length > 80 ? 'Received.' : trimmed || 'Received.'
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
    content: `${baseContent}\n\n## Deep Forge notes\n${transcript || 'User confirmed this document package.'}`,
    techNotes: [
      node.techNotes,
      'Deep Forge confirmed manually; notes merged into the document package.',
    ].filter(Boolean).join('\n\n'),
  }
}

function countImageBlocks(messages: ChatMessage[]) {
  return messages.reduce((sum, message) => {
    if (typeof message.content === 'string') return sum
    return sum + message.content.filter((block) => block.type === 'image').length
  }, 0)
}

function collectFigmaAssetDependencies(messages: ChatMessage[]): AssetDependency[] {
  const assets: AssetDependency[] = []
  const seen = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = typeof message.content === 'string'
      ? message.content
      : message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const match = /Cached resource:\s*(\S+)/u.exec(lines[index])
      if (!match) continue
      const url = match[1]
      if (seen.has(url)) continue
      seen.add(url)
      const descriptor = lines[index - 1]?.trim() || `Figma 子图 ${assets.length + 1}`
      assets.push({
        type: descriptor.includes('整帧') ? 'FigmaFrameImage' : 'FigmaSubImage',
        path: `${url} | ${descriptor}`,
        is_ready: true,
      })
    }
  }

  return assets.slice(0, MAX_PROTOTYPE_IMAGES)
}

// Image blocks carry no role metadata; ForgeChat encodes the role in text lines like
// "1. 布局参考：name". We parse those lines to map each image (same order) to its role
// so reference images can be prioritized for prototype generation.
function isReferenceRoleLine(line: string) {
  return line.includes('layout_reference') || line.includes('????')
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

function isPreviewableUiFile(file: { url?: string | null; type?: string | null; path: string }) {
  const text = `${file.type ?? ''} ${file.path}`.toLowerCase()
  return /\.(png|jpe?g|webp|gif|svg)$/u.test(text)
}

interface InterfacePrototypeBase {
  html: string
  name: string
  rowId: string
  blueprint: PrototypeInterfaceBlueprint | null
}

type UiAssetWorkbenchRow = AssetWorkbenchState['uiRows'][number]
type UiAssetWorkbenchFile = NonNullable<UiAssetWorkbenchRow['result']>['files'][number]

function findUiAssetFile(row: UiAssetWorkbenchRow, predicate: (file: UiAssetWorkbenchFile) => boolean) {
  return row.result?.files.find(predicate) ?? null
}

function buildFallbackInterfaceBlueprint(row: UiAssetWorkbenchRow): PrototypeInterfaceBlueprint | null {
  if (row.kind !== 'interface' || row.status !== 'ready' || !row.result) return null
  const uiSpecFile = findUiAssetFile(row, (file) => /(^|[\\/])ui_spec\.json$/iu.test(file.path) || file.name === 'ui_spec.json')
  const manifestFile = findUiAssetFile(row, (file) => /(^|[\\/])export_manifest\.json$/iu.test(file.path) || file.name === 'export_manifest.json')
  if (!uiSpecFile && !row.result.uiSpecPath) return null
  const imageFiles = row.result.files.filter((file) => file.url && isPreviewableUiFile(file))
  return {
    id: row.id,
    name: row.name || row.result.panelName || '界面底板',
    sourceRowId: row.id,
    sourceUrl: row.figmaUrl || row.result.sourceUrl,
    uiSpecPath: row.result.uiSpecPath ?? uiSpecFile?.path ?? null,
    uiSpecUrl: uiSpecFile?.url ?? null,
    manifestPath: row.result.manifestPath ?? manifestFile?.path ?? null,
    manifestUrl: manifestFile?.url ?? null,
    htmlAvailable: Boolean(row.result.html?.trim()),
    designSize: null,
    root: null,
    nodes: [],
    assetNames: imageFiles.map((file) => file.name).slice(0, 80),
    assetCount: row.result.assetCount,
    nodeCount: null,
  }
}

function interfaceBlueprintForRow(row: UiAssetWorkbenchRow): PrototypeInterfaceBlueprint | null {
  if (row.kind !== 'interface' || row.status !== 'ready' || !row.result) return null
  const fallback = buildFallbackInterfaceBlueprint(row)
  const blueprint = row.result.interfaceBlueprint ?? fallback
  if (!blueprint) return null
  const uiSpecFile = findUiAssetFile(row, (file) => /(^|[\\/])ui_spec\.json$/iu.test(file.path) || file.name === 'ui_spec.json')
  const manifestFile = findUiAssetFile(row, (file) => /(^|[\\/])export_manifest\.json$/iu.test(file.path) || file.name === 'export_manifest.json')
  return {
    ...blueprint,
    id: row.id,
    name: row.name || blueprint.name || row.result.panelName || '界面底板',
    sourceRowId: row.id,
    sourceUrl: row.figmaUrl || blueprint.sourceUrl || row.result.sourceUrl,
    uiSpecPath: row.result.uiSpecPath ?? blueprint.uiSpecPath ?? uiSpecFile?.path ?? null,
    uiSpecUrl: blueprint.uiSpecUrl ?? uiSpecFile?.url ?? null,
    manifestPath: row.result.manifestPath ?? blueprint.manifestPath ?? manifestFile?.path ?? null,
    manifestUrl: blueprint.manifestUrl ?? manifestFile?.url ?? null,
    htmlAvailable: Boolean(row.result.html?.trim()),
    nodes: blueprint.nodes ?? [],
    assetNames: blueprint.assetNames ?? fallback?.assetNames ?? [],
  }
}

function findInterfacePrototypeBase(assetWorkbench: AssetWorkbenchState, preferredRowId?: string | null): InterfacePrototypeBase | null {
  const rows = preferredRowId
    ? [
        ...assetWorkbench.uiRows.filter((row) => row.id === preferredRowId),
        ...assetWorkbench.uiRows.filter((row) => row.id !== preferredRowId),
      ]
    : assetWorkbench.uiRows
  for (const row of rows) {
    const html = row.kind === 'interface' && row.status === 'ready' ? row.result?.html?.trim() : null
    if (!html) continue
    return {
      html,
      name: row.name || row.result?.panelName || '界面底板',
      rowId: row.id,
      blueprint: interfaceBlueprintForRow(row),
    }
  }
  return null
}

function buildInterfacePrototypeBaseInstruction(base: InterfacePrototypeBase, instruction: string) {
  const blueprint = base.blueprint
  const blueprintNodeCount = blueprint ? (blueprint.nodeCount ?? (blueprint.nodes.length || null)) : null
  const blueprintAssetCount = blueprint ? (blueprint.assetCount ?? (blueprint.assetNames.length || null)) : null
  const blueprintLines = blueprint
    ? [
        `界面蓝图：${blueprint.name}`,
        `ui_spec.json：${blueprint.uiSpecPath ?? blueprint.uiSpecUrl ?? '已解析但未记录路径'}`,
        blueprint.designSize?.width && blueprint.designSize?.height ? `设计尺寸：${blueprint.designSize.width}x${blueprint.designSize.height}` : null,
        blueprint.root ? `根节点：${blueprint.root.name} / ${blueprint.root.type} / ${blueprint.root.rect.width}x${blueprint.root.rect.height}` : null,
        `节点数量：${blueprintNodeCount ?? '未知'}；子图数量：${blueprintAssetCount ?? '未知'}`,
      ].filter(Boolean).join('\n')
    : null
  return [
    `以素材库界面 HTML「${base.name}」作为本轮原型底板。`,
    blueprintLines,
    'ui_spec.json 是本轮界面的版式契约：必须保持根尺寸、节点 rect、层级关系、子图映射和原界面视觉风格。',
    '保留底板已有布局、层级和素材 URL，只围绕当前节点需求做必要的交互状态、文案和局部补充。',
    '不要重绘底板中已有界面，也不要引用素材库清单外的图片、特效、字体或外链资源。',
    instruction ? `本轮打磨要求：${instruction}` : '本轮打磨要求：根据当前 PRD 节点补齐可交付的交互状态和必要标注。',
  ].join('\n')
}

function buildPrototypeGenerationModeInstruction(mode: PrototypeGenerationMode, instruction: string) {
  const trimmed = instruction.trim()
  const requestLine = trimmed ? `本轮打磨要求：${trimmed}` : null

  if (mode === 'draft_preview') {
    return [
      '本轮使用草稿预览模式：目标是快速看效果、验证交互方向和发现缺口，不作为最终交付标准。',
      '可以基于 PRD、文字、截图或 Figma 视觉证据生成；如果提供了 Figma/图片，优先对齐其布局和视觉结构。',
      '当前 PRD 节点负责交互、数据状态和异常分支；不要把 Figma 示例数值当真实业务值。',
      requestLine,
    ].filter(Boolean).join('\n')
  }

  return [
    '本轮使用资源库标准模式：先把 PRD、草稿预览或补充图片输入归纳为界面 Blueprint，再映射到素材库中的界面底板、散图和特效预览。',
    '输出 HTML 只能引用素材库允许 URL 和 Tailwind CDN；没有命中的素材用占位块、状态文字或真实 UI 状态表达，不要引用外部图片、base64、随机网络图或本地路径。',
    '优先保持素材库界面底板的布局和层级；只补充当前节点需要的交互状态、数据分支、按钮反馈、异常态和验收用切换。',
    requestLine,
  ].filter(Boolean).join('\n')
}

function buildPrototypeAssetManifest(
  assetWorkbench: AssetWorkbenchState,
  mode: PrototypeAssetManifest['mode'] = 'audit',
  preferredInterfaceAssetId?: string | null,
): PrototypeAssetManifest {
  const assets: PrototypeAssetManifest['assets'] = []
  const notes: string[] = []
  const interfaceBlueprints: PrototypeInterfaceBlueprint[] = []
  const uiRows = preferredInterfaceAssetId
    ? [
        ...assetWorkbench.uiRows.filter((row) => row.id === preferredInterfaceAssetId),
        ...assetWorkbench.uiRows.filter((row) => row.id !== preferredInterfaceAssetId),
      ]
    : assetWorkbench.uiRows

  for (const row of uiRows) {
    if (row.status !== 'ready' || !row.result) continue
    if (row.kind === 'interface' && row.result.html?.trim()) {
      const blueprint = interfaceBlueprintForRow(row)
      if (blueprint) interfaceBlueprints.push(blueprint)
      notes.push(mode === 'strict'
        ? `界面类素材「${row.name}」提供可直接复用的 HTML 底板和 ui_spec.json 蓝图；资源库标准模式必须基于它的 JSON 节点、rect、层级和子图映射迭代。`
        : `界面类素材「${row.name}」提供可直接复用的 HTML 底板和 ui_spec.json 蓝图；可在资源库标准模式中作为规范底板。`)
    }
    const files = row.result.files.filter((file) => file.url && isPreviewableUiFile(file))
    if (!files.length) {
      notes.push(`${row.kind === 'interface' ? '界面类素材' : '散图素材'}「${row.name}」没有可直接引用的图片 URL；不要为它虚构路径。`)
      continue
    }
    for (const file of files) {
      assets.push({
        id: `${row.id}:${file.path}`,
        kind: row.kind === 'interface' ? 'interface_image' : 'ui_image',
        name: row.kind === 'interface' ? `${row.name} / ${file.name}` : `${row.name} / ${file.name}`,
        url: file.url!,
        source: 'ui_asset',
        purpose: row.purpose || row.result.summary,
        usageNote: row.usageNote || null,
        originalName: file.name,
        assetGroupName: row.name,
      })
    }
  }

  for (const row of assetWorkbench.effectRows) {
    const effectContext = [row.purpose, row.pageHint, row.implementationHint, row.usageNote].filter(Boolean).join(' / ')
    if (row.status !== 'ready' || row.loadStatus !== 'loaded') {
      if (effectContext) notes.push(`特效「${row.name}」尚未加载，不允许在 HTML 中表现；用途备注：${effectContext}`)
      continue
    }
    if (!row.previewUrl || row.previewFiles.length === 0) {
      notes.push(`特效「${row.name}」已加载但没有可预览图片/序列帧/视频/音频，不允许画成真实特效；用途备注：${effectContext || '未填写'}`)
      continue
    }
    for (const [index, file] of row.previewFiles.entries()) {
      assets.push({
        id: `${row.id}:preview:${index}`,
        kind: 'effect_preview',
        name: row.previewType === 'sequence' ? `${row.name} / 序列帧 ${index + 1}` : `${row.name} / 预览`,
        url: file.url,
        source: 'effect_asset',
        purpose: effectContext || row.purpose || row.pageHint || null,
        usageNote: row.usageNote || null,
        originalName: file.name || row.name,
        assetGroupName: row.name,
      })
    }
  }

  if (assets.length === 0) {
    notes.push('当前素材库没有可用于 HTML 原型的 ready URL；生成结果只能使用占位和真实界面状态，不能伪造资源。')
  }

  return {
    mode,
    assets,
    notes,
    interfaceBlueprints,
  }
}

function buildMvcChildContext(node: PrdNode, tree: Record<string, PrdNode> | null) {
  const children = node.children.map((childId) => tree?.[childId]).filter((child): child is PrdNode => Boolean(child))
  if (!children.length) return null
  return [
    'Page MVC child node context:',
    ...children.map((child) => [
      `- ${child.label} (${child.id} / ${child.type} / ${formatSpecLens(resolveNodeSpecLens(child))})`,
      `  Summary: ${child.summary}`,
      `  Content: ${child.content}`,
      child.techNotes ? `  技术备注：${child.techNotes}` : null,
      child.docPath ? `  Doc path: ${child.docPath}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n')
}

function buildPageSectionContext(node: PrdNode, tree: Record<string, PrdNode> | null) {
  const deliverySections = buildDeliverySections(node, tree)
  if (deliverySections.some((section) => section.status !== 'missing')) {
    return [
      'Page View / Flow / Data spec:',
      ...deliverySections.map((section) => {
        if (section.status === 'missing') return null
        return [
          `## ${section.title}`,
          `Status: ${section.status === 'ready' ? 'ready' : 'pending'}`,
          section.summary ? `Summary: ${section.summary}` : null,
          section.content ? `Content: ${section.content}` : null,
          section.openQuestions.length ? `Open questions: ${section.openQuestions.join('; ')}` : null,
          section.sourceNodeIds.length ? `Folded source nodes: ${section.sourceNodeIds.join(', ')}` : null,
        ].filter(Boolean).join('\n')
      }).filter((item): item is string => Boolean(item)),
    ].join('\n\n')
  }
  if (!hasNodeSections(node.sections)) return null
  return [
    'Page spec sections:',
    ...(['view', 'interaction', 'data'] as const).map((key) => {
      const section = node.sections?.[key]
      if (!section?.summary && !section?.content) return null
      return [
        `## ${section.title ?? formatSectionTitle(key)}`,
        section.summary ? `Summary: ${section.summary}` : null,
        section.content ? `Content: ${section.content}` : null,
      ].filter(Boolean).join('\n')
    }).filter((item): item is string => Boolean(item)),
  ].join('\n\n')
}

function buildBackendContractContext(node: PrdNode, tree: Record<string, PrdNode> | null) {
  const contracts = collectBackendContracts(node, tree)
  if (!contracts.length) return null
  return [
    'Backend contract / dependency references:',
    ...contracts.map((contract) => [
      `- ${contract.title} (${contract.kind})`,
      contract.summary ? `  Description: ${contract.summary}` : null,
      contract.fields?.length ? `  Fields: ${contract.fields.join(', ')}` : null,
      contract.targetNodeId ? `  Target node: ${contract.targetNodeId}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n')
}

function buildNodePrototypeRequirement(
  node: PrdNode,
  messages: ChatMessage[],
  tree: Record<string, PrdNode> | null,
  options: { allowFigmaAssetReferences?: boolean } = {},
): UXRequirementState {
  const transcript = messages
    .slice(-12)
    .map((message) => {
      const text = contentText(message.content)
      if (!text) return null
      return `${message.role === 'user' ? 'User' : 'AI'}: ${text}`
    })
    .filter((item): item is string => Boolean(item))
    .join('\n')
  const referenceCount = countImageBlocks(messages)
  const mvcChildContext = node.type === 'page' ? buildMvcChildContext(node, tree) : null
  const pageSectionContext = buildPageSectionContext(node, tree)
  const backendContractContext = buildBackendContractContext(node, tree)
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
  const figmaAssets = options.allowFigmaAssetReferences === false ? [] : collectFigmaAssetDependencies(messages)
  const genericReferenceAssets = Array.from({ length: Math.max(0, referenceCount - figmaAssets.length) }, (_, index) => ({
    type: 'ReferenceImage',
    path: `Reference image ${index + 1} in the current node chat`,
    is_ready: true,
  }))

  return {
    trigger_condition: `Generate a mobile interaction prototype from PRD node ${node.id} (${node.label}).`,
    sequence_rules: [
      stripPolishSection(node.content),
      pageSectionContext,
      mvcChildContext,
      backendContractContext,
      performanceContext,
      transcript ? `\nDeep Forge conversation summary:\n${transcript}` : null,
    ].filter(Boolean).join('\n\n'),
    asset_dependencies: [
      ...figmaAssets,
      ...genericReferenceAssets,
      ...performanceAssets,
    ],
    engine_constraints: node.techNotes ?? 'Game UI for Cocos Creator; restore mobile portrait UI and key interaction states.',
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
      asset_dependencies: referenceCount > 0 ? null : 'Upload reference images to improve prototype fidelity.',
      engine_constraints: null,
    },
    next_question: null,
    performance_spec: performanceSpec?.detected && !performanceSpec.disabled ? performanceSpec : null,
  }
}

function buildFigmaEvidenceContent(result: FigmaFrameImportResponse): ContentBlock[] {
  const formatNumericTextSlots = (image: FigmaFrameImportResponse['images'][number]) => {
    const slots = image.numericTextSlots ?? []
    if (!slots.length) return ''
    return [
      `   Numeric placeholders: ${slots.length} sample values were removed; overlay real business values at these coordinates in HTML.`,
      ...slots.map((slot) => (
        `   - ${slot.slotId}: x=${slot.x}, y=${slot.y}, w=${slot.width}, h=${slot.height}, center=(${slot.centerX}, ${slot.centerY})`
      )),
    ].join('\n')
  }
  const imageLines = result.images.map((image, index) => (
    [
      `${index + 1}. layout_reference (${image.depth === 0 ? 'full frame' : 'Figma child'}): ${image.name} / ${image.type} / ${image.width}x${image.height}`,
      `   Cached resource: ${image.assetUrl}`,
      formatNumericTextSlots(image),
    ].filter(Boolean).join('\n')
  ))
  const numericSlotCount = result.images.reduce((sum, image) => sum + (image.numericTextSlots?.length ?? 0), 0)

  return [
    {
      type: 'text',
      text: [
        `Figma Frame: ${result.panelName}`,
        `Source URL: ${result.sourceUrl}`,
        `Extraction result: ${result.imageCount} visual evidence image(s).`,
        numericSlotCount ? `Numeric handling: removed ${numericSlotCount} sample value(s); use real business values or dynamic placeholders.` : null,
        '',
        'Use the current PRD node and the attached Figma child images to generate the right-side HTML prototype. Visual layout should follow Figma; state/data logic should follow PRD.',
        numericSlotCount ? 'Do not restore guessed Figma sample numbers; use real PRD/chat values or dynamic placeholders.' : null,
        '',
        'Figma child images:',
        imageLines.join('\n'),
      ].join('\n'),
    },
    ...result.images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ]
}

function buildCombinedFigmaEvidenceContent(results: FigmaFrameImportResponse[]): ContentBlock[] {
  if (results.length === 0) return []
  if (results.length === 1) return buildFigmaEvidenceContent(results[0])

  let imageNumber = 0
  const formatNumericTextSlots = (image: FigmaFrameImportResponse['images'][number]) => {
    const slots = image.numericTextSlots ?? []
    if (!slots.length) return ''
    return [
      `   Numeric placeholders: ${slots.length} sample values were removed; overlay real business values at these coordinates in HTML.`,
      ...slots.map((slot) => (
        `   - ${slot.slotId}: x=${slot.x}, y=${slot.y}, w=${slot.width}, h=${slot.height}, center=(${slot.centerX}, ${slot.centerY})`
      )),
    ].join('\n')
  }
  const imageLines = results.flatMap((result, resultIndex) => [
    `Source ${resultIndex + 1}: ${result.panelName}`,
    `URL: ${result.sourceUrl}`,
    ...result.images.map((image) => {
      imageNumber += 1
      return [
        `${imageNumber}. layout_reference (${image.depth === 0 ? 'full frame' : 'Figma child'}): ${image.name} / ${image.type} / ${image.width}x${image.height}`,
        `   Cached resource: ${image.assetUrl}`,
        formatNumericTextSlots(image),
      ].filter(Boolean).join('\n')
    }),
  ])
  const totalImageCount = results.reduce((sum, result) => sum + result.imageCount, 0)
  const numericSlotCount = results.reduce(
    (sum, result) => sum + result.images.reduce((imageSum, image) => imageSum + (image.numericTextSlots?.length ?? 0), 0),
    0,
  )

  return [
    {
      type: 'text',
      text: [
        `Figma asset group: ${results.length} link(s).`,
        `Extraction result: ${totalImageCount} visual evidence image(s).`,
        numericSlotCount ? `Numeric handling: removed ${numericSlotCount} sample value(s); use real business values or dynamic placeholders.` : null,
        '',
        'Use these Figma child images as UI assets, list items, icons, or layout references for the right-side HTML prototype; do not write them into the requirements document unless explicitly asked.',
        numericSlotCount ? 'Do not restore guessed Figma sample numbers; use real PRD/chat values or dynamic placeholders.' : null,
        '',
        'Figma child images:',
        imageLines.join('\n'),
      ].join('\n'),
    },
    ...results.flatMap((result) => result.images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    }))),
  ]
}

function combineUiFeedbackWithFigmaEvidence(feedback: ChatMessage['content'], figmaEvidence: ContentBlock[]): ChatMessage['content'] {
  const feedbackText = chatContentText(feedback)
  const figmaText = chatContentText(figmaEvidence)
  return [
    {
      type: 'text',
      text: [
        'Current user UI iteration request:',
        feedbackText || 'Iterate the right-side UI prototype according to the Figma visual evidence.',
        '',
        figmaText,
      ].filter(Boolean).join('\n'),
    },
    ...chatContentImages(feedback),
    ...chatContentImages(figmaEvidence),
  ]
}

export function ForgePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const [, navigate] = useLocation()

  const prdTree = useAppStore((s) => s.prdTree)
  const nodeChats = useAppStore((s) => s.nodeChats)
  const nodeOperationSuggestions = useAppStore((s) => s.nodeOperationSuggestions)
  const settings = useAppStore((s) => s.settings)
  const assetWorkbench = useAppStore((s) => s.assetWorkbench)
  const appendNodeMessage = useAppStore((s) => s.appendNodeMessage)
  const removeLastNodeChatTurn = useAppStore((s) => s.removeLastNodeChatTurn)
  const clearNodeChat = useAppStore((s) => s.clearNodeChat)
  const applyNodeOperationSuggestion = useAppStore((s) => s.applyNodeOperationSuggestion)
  const dismissNodeOperationSuggestion = useAppStore((s) => s.dismissNodeOperationSuggestion)
  const applyNodePolish = useAppStore((s) => s.applyNodePolish)
  const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)
  const nodePrototypeState = useAppStore((s) => nodeId ? s.nodePrototypeStates[nodeId] : undefined)
  const prototypeHtml = nodePrototypeState?.prototypeHtml ?? null
  const prototypeHistory = nodePrototypeState?.prototypeHistory ?? []
  const prototypeVariants = nodePrototypeState?.prototypeVariants ?? []
  const selectedVariantIndex = nodePrototypeState?.selectedVariantIndex ?? -1
  const recordNodePrototypeHistory = useAppStore((s) => s.recordNodePrototypeHistory)
  const restoreNodePrototypeVersion = useAppStore((s) => s.restoreNodePrototypeVersion)
  const clearNodePrototypeHistory = useAppStore((s) => s.clearNodePrototypeHistory)
  const setNodePrototypeVariants = useAppStore((s) => s.setNodePrototypeVariants)
  const updateNodePrototypeVariant = useAppStore((s) => s.updateNodePrototypeVariant)
  const selectNodePrototypeVariant = useAppStore((s) => s.selectNodePrototypeVariant)
  const setNodePrototypeHtml = useAppStore((s) => s.setNodePrototypeHtml)

  const [nodeComplete, setNodeComplete] = useState(false)
  const [isGeneratingPrototype, setIsGeneratingPrototype] = useState(false)
  const [isCancellingPrototype, setIsCancellingPrototype] = useState(false)
  const [assetWorkbenchOpen, setAssetWorkbenchOpen] = useState(false)
  const prototypeAbortControllerRef = useRef<AbortController | null>(null)

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
    if (node && prdTree && !isDeliveryNode(node, prdTree)) navigate('/')
  }, [node, nodeId, navigate, prdTree])

  useEffect(() => {
    setNodeComplete(node?.status === 'done')
  }, [nodeId, node?.status])

  useEffect(() => () => {
    prototypeAbortControllerRef.current?.abort()
    prototypeAbortControllerRef.current = null
  }, [nodeId])

  function handleCancelPrototypeGeneration() {
    const controller = prototypeAbortControllerRef.current
    if (!controller || controller.signal.aborted) return
    setIsCancellingPrototype(true)
    controller.abort()
  }

  useEffect(() => {
    if (!nodeId || !node) return
    if ((useAppStore.getState().nodeChats[nodeId] ?? []).length > 0) return
    const performanceSpec = resolveNodePerformanceSpec(node)
    const hasPerformanceSpec = Boolean(performanceSpec?.detected && !performanceSpec.disabled)
    const visualPrompt = prototypeHtml
      ? 'I see an existing prototype on the right. Can it be used as the visual reference for this interface?'
      : 'Please upload a prototype screenshot/reference image or paste a Figma link. If none, reply: no prototype resource.'
    const nextStep = prototypeHtml
      ? `After confirmation I will continue polishing main flow, edge states, dependency fields, and acceptance criteria${hasPerformanceSpec ? ', then handle performance orchestration' : ''}.`
      : 'After receiving a prototype resource or a no-resource answer, I will continue with the next concrete question.'
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: `Polishing ${node.label}.\n${visualPrompt}\n${nextStep}`,
    })
  }, [appendNodeMessage, node, nodeId, prototypeHtml])

  async function handleSend(content: ChatMessage['content'], options: ForgeSendOptions = {}) {
    if (!nodeId || !prdTree || !node) return
    const userMsg: ChatMessage = { role: 'user', content }
    if (!options.suppressUserEcho) {
      appendNodeMessage(nodeId, userMsg)
    }
    let resolvedFigmaEvidence: ContentBlock[] | null | undefined
    const resolveFigmaEvidence = async () => {
      if (resolvedFigmaEvidence !== undefined) return resolvedFigmaEvidence
      const figmaUrls = extractFigmaUrlsFromText(chatContentText(content))
      resolvedFigmaEvidence = figmaUrls.length
        ? buildCombinedFigmaEvidenceContent(await Promise.all(
            figmaUrls.map((url) => importFigmaFrame(settings.proxyBaseUrl, { url })),
          ))
        : null
      return resolvedFigmaEvidence
    }

    try {
      if (!options.performancePolishMode && isUiOnlyPrototypeFeedback(content)) {
        const figmaEvidence = await resolveFigmaEvidence()
        const evidenceContent = figmaEvidence
          ? combineUiFeedbackWithFigmaEvidence(content, figmaEvidence)
          : content

        let prototypeUpdated = false
        try {
          prototypeUpdated = await handleGeneratePrototype(buildUiOnlyPrototypeInstruction(content), {
            recordInstruction: false,
            evidenceContent,
            currentTurnOnly: true,
            generationMode: options.generationMode,
          })
        } catch (err) {
          if (isAbortError(err)) return
          throw err
        }
        appendNodeMessage(nodeId, {
          role: 'assistant',
          content: prototypeUpdated ? 'Completed this UI iteration.' : 'UI iteration failed: no new HTML was generated.',
        })
        return
      }

      const response = await sendNodeChatMessage(
        settings.proxyBaseUrl,
        nodeId,
        userMsg,
        prdTree,
        options,
      )
      const documentUpdated = Boolean(
        response.nodePatch
        || response.nodeComplete
        || response.intents?.some((intent) => intent === 'document_polish' || intent === 'reference_feedback'),
      )
      let prototypeUpdated = false
      let prototypeError: string | null = null
      if (response.nodePatch) {
        applyNodePolish(nodeId, mergePolishPatch(response.nodePatch))
      }
      if (response.nodeComplete) {
        setNodeComplete(true)
        updateNodeStatus(nodeId, 'done')
      }
      const prototypeInstruction = response.prototypeInstruction?.trim()
      if (prototypeInstruction) {
        try {
          const figmaEvidence = await resolveFigmaEvidence()
          prototypeUpdated = await handleGeneratePrototype(prototypeInstruction, {
            recordInstruction: false,
            evidenceContent: figmaEvidence
              ? combineUiFeedbackWithFigmaEvidence(content, figmaEvidence)
              : content,
            currentTurnOnly: true,
            generationMode: options.generationMode,
          })
          if (!prototypeUpdated) prototypeError = 'No new HTML was generated.'
        } catch (err) {
          if (!isAbortError(err)) prototypeError = err instanceof Error ? err.message : 'UI 迭代失败'
        }
      }
      const shouldKeepAiQuestion = options.performancePolishMode === true && response.reply.trim().length > 0
      const statusText = prototypeError
        ? documentUpdated
          ? `Recorded this requirement, but UI iteration failed: ${prototypeError}`
          : `UI iteration failed: ${prototypeError}`
        : shouldKeepAiQuestion
          ? response.reply
          : formatNodeChatStatus(documentUpdated, prototypeUpdated, response.reply)
      appendNodeMessage(nodeId, { role: 'assistant', content: statusText })
    } catch (err) {
      if (isAbortError(err)) return
      const message = err instanceof Error ? err.message : '发送失败，请重试。'
      appendNodeMessage(nodeId, { role: 'assistant', content: `请求失败：${message}` })
      throw err
    }
  }

  function handleClassifyImageAttachment(input: ReferenceImageClassificationRequest) {
    return classifyReferenceImage(settings.proxyBaseUrl, input)
  }

  async function handleImportFigmaFrame(input: { url: string }, options: { generationMode?: PrototypeGenerationMode } = {}) {
    if (!nodeId) throw new Error('No selected node.')
    const generationMode = options.generationMode ?? 'draft_preview'
    appendNodeMessage(nodeId, {
      role: 'assistant',
      content: generationMode === 'resource_standard'
        ? 'Parsing Figma Frame as standard-generation evidence, then generating with resource-library constraints.'
        : 'Parsing Figma Frame as draft-preview evidence, then generating a right-side HTML prototype from the current node.',
    })
    try {
      const result = await importFigmaFrame(settings.proxyBaseUrl, input)
      const evidenceContent = buildFigmaEvidenceContent(result)
      const currentPrototypeState = useAppStore.getState().nodePrototypeStates[nodeId]
      const selectedVariant = currentPrototypeState?.prototypeVariants.find((variant) => variant.index === currentPrototypeState.selectedVariantIndex)
      const hasExistingPrototype = Boolean(selectedVariant?.html ?? currentPrototypeState?.prototypeHtml)
      const instruction = buildFigmaPrototypeIterationInstruction(result, hasExistingPrototype)
      const prototypeUpdated = await handleGeneratePrototype(instruction, { singlePrototypeOnly: true, evidenceContent, currentTurnOnly: true, generationMode })
      if (!prototypeUpdated) {
        throw new Error('Figma parsed, but no updated HTML prototype was generated.')
      }
      appendNodeMessage(nodeId, {
        role: 'assistant',
        content: generationMode === 'resource_standard'
          ? `${result.summary}\n\nGenerated through the resource-library standard pipeline. Figma is used as visual evidence; final assets are constrained by the library manifest.`
          : hasExistingPrototype
            ? `${result.summary}\n\nUpdated the draft preview from Figma child images.`
            : `${result.summary}\n\nGenerated the draft preview from the current PRD document and Figma child images.`,
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Figma import or HTML prototype generation failed.'
      appendNodeMessage(nodeId, {
        role: 'assistant',
        content: `Figma import or HTML generation failed: ${message}`,
      })
      throw err
    }
  }

  async function handleGeneratePrototype(instruction?: string, options?: ForgePrototypeOptions) {
    if (!node || !nodeId) return false
    const runningController = prototypeAbortControllerRef.current
    if (runningController && !runningController.signal.aborted) return false
    const abortController = new AbortController()
    prototypeAbortControllerRef.current = abortController
    const generationMode = options?.generationMode ?? 'draft_preview'
    const trimmedInstruction = instruction?.trim() ?? ''
    const shouldRecordInstruction = Boolean(options?.recordInstruction && trimmedInstruction && nodeId)
    let prototypeCompleted = false
    if (shouldRecordInstruction) {
      appendNodeMessage(nodeId, { role: 'user', content: `Prototype edit: ${trimmedInstruction}` })
    }
    const prototypeEvidenceContent = mergeInstructionIntoPrototypeEvidence(trimmedInstruction, options?.evidenceContent)
    const currentMessages = options?.currentTurnOnly
      ? []
      : nodeId ? (useAppStore.getState().nodeChats[nodeId] ?? messages) : messages
    const evidenceMessages = prototypeEvidenceContent
      ? [...currentMessages, { role: 'user' as const, content: prototypeEvidenceContent }]
      : currentMessages
    const currentNode = nodeId ? (useAppStore.getState().prdTree?.[nodeId] ?? node) : node
    const referenceImages = collectPrototypeImages(evidenceMessages)
    const currentStore = useAppStore.getState()
    const requirementState = buildNodePrototypeRequirement(currentNode, evidenceMessages, currentStore.prdTree, {
      allowFigmaAssetReferences: generationMode !== 'resource_standard',
    })
    const assetManifest = buildPrototypeAssetManifest(
      currentStore.assetWorkbench,
      generationMode === 'resource_standard' ? 'strict' : 'audit',
      options?.preferredInterfaceAssetId,
    )
    const currentPrototypeState = currentStore.nodePrototypeStates[nodeId ?? '']
    const prototypeSnapshotBeforeGeneration = {
      prototypeHtml: currentPrototypeState?.prototypeHtml ?? null,
      prototypeVariants: currentPrototypeState?.prototypeVariants ?? [],
      selectedVariantIndex: currentPrototypeState?.selectedVariantIndex ?? -1,
    }
    const selectedVariant = currentPrototypeState?.prototypeVariants.find((variant) => variant.index === currentPrototypeState?.selectedVariantIndex)
    const selectedPrototypeHtml = selectedVariant?.html ?? currentPrototypeState?.prototypeHtml ?? null
    const shouldUseInterfaceBase = generationMode === 'resource_standard' && (options?.forceInterfaceBase === true || !selectedPrototypeHtml)
    const interfacePrototypeBase = shouldUseInterfaceBase
      ? findInterfacePrototypeBase(currentStore.assetWorkbench, options?.preferredInterfaceAssetId)
      : null
    const prototypeBaseHtml = interfacePrototypeBase?.html ?? selectedVariant?.html ?? selectedPrototypeHtml ?? null
    const prototypeBaseIndex = interfacePrototypeBase ? 0 : selectedVariant?.index ?? 0
    const prototypeBaseHistory = interfacePrototypeBase ? [] : selectedVariant?.history ?? []
    const generationInstruction = buildPrototypeGenerationModeInstruction(generationMode, trimmedInstruction)
    const effectiveInstruction = interfacePrototypeBase
      ? buildInterfacePrototypeBaseInstruction(interfacePrototypeBase, generationInstruction)
      : generationInstruction
    const isAssetBaseUpdate = Boolean(interfacePrototypeBase)
    const shouldRecordCurrentBeforeAssetBase = Boolean(interfacePrototypeBase && selectedPrototypeHtml && options?.forceInterfaceBase)
    const isUpdate = Boolean(effectiveInstruction && prototypeBaseHtml)
    const createVariantCount = options?.singlePrototypeOnly ? 1 : 2
    const updateVariantCount = options?.singlePrototypeOnly ? 1 : 2
    let prototypeErrorMessage: string | null = null

    const restorePrototypeAfterCancel = () => {
      setNodePrototypeVariants(nodeId, prototypeSnapshotBeforeGeneration.prototypeVariants)
      const latestPrototypeHtml = useAppStore.getState().nodePrototypeStates[nodeId]?.prototypeHtml ?? null
      if (prototypeSnapshotBeforeGeneration.prototypeHtml && latestPrototypeHtml !== prototypeSnapshotBeforeGeneration.prototypeHtml) {
        setNodePrototypeHtml(nodeId, prototypeSnapshotBeforeGeneration.prototypeHtml, { mode: 'restore', note: '取消生成恢复' })
      }
      if (prototypeSnapshotBeforeGeneration.selectedVariantIndex >= 0) {
        selectNodePrototypeVariant(nodeId, prototypeSnapshotBeforeGeneration.selectedVariantIndex)
      }
    }

    setIsGeneratingPrototype(true)
    setIsCancellingPrototype(false)
    try {
      if (isUpdate && prototypeBaseHtml) {
        if (shouldRecordCurrentBeforeAssetBase && selectedPrototypeHtml) {
          recordNodePrototypeHistory(nodeId, selectedPrototypeHtml, { mode: 'update', note: `切换到资源库界面：${interfacePrototypeBase?.name ?? '界面底板'}` })
        }
        if (!isAssetBaseUpdate) {
          recordNodePrototypeHistory(nodeId, prototypeBaseHtml, { mode: 'update', note: `修改前：${trimmedInstruction}` })
        }
        setNodePrototypeVariants(nodeId, Array.from({ length: updateVariantCount }, (_, offset) => ({
          index: prototypeBaseIndex + offset,
          html: offset === 0 ? prototypeBaseHtml : null,
          status: 'streaming' as const,
          focus: offset === 0 ? selectedVariant?.focus : undefined,
          history: offset === 0 ? prototypeBaseHistory : undefined,
          assetAudit: offset === 0 ? selectedVariant?.assetAudit : undefined,
        })))
        let didReceivePrototypeHtml = false
        await streamPrototype(
          settings.proxyBaseUrl,
          requirementState,
          {
            currentHtml: prototypeBaseHtml,
            instruction: effectiveInstruction,
            images: referenceImages,
            numVariants: updateVariantCount,
            variantIndex: prototypeBaseIndex,
            history: prototypeBaseHistory,
            assetManifest,
            signal: abortController.signal,
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
              if (event.variantIndex === prototypeBaseIndex && event.html) selectNodePrototypeVariant(nodeId, event.variantIndex)
            } else if (event.type === 'variantComplete') {
              if (event.html) didReceivePrototypeHtml = true
              updateNodePrototypeVariant(nodeId, event.variantIndex, {
                html: event.html,
                status: 'complete',
                focus: event.focus,
                history: event.history,
                assetAudit: event.assetAudit,
              })
              if (event.variantIndex === prototypeBaseIndex && event.html) selectNodePrototypeVariant(nodeId, event.variantIndex)
            } else if (event.type === 'variantError') {
              prototypeErrorMessage = event.message ?? prototypeErrorMessage
              updateNodePrototypeVariant(nodeId, event.variantIndex, { status: 'error', focus: event.focus, error: event.message })
            }
          },
        )
        if (!didReceivePrototypeHtml) {
          throw new Error(prototypeErrorMessage ?? 'Prototype update did not return complete HTML.')
        }
        const variants = useAppStore.getState().nodePrototypeStates[nodeId]?.prototypeVariants ?? []
        const completedVariant = variants.find((variant) => variant.index === prototypeBaseIndex && variant.status === 'complete' && variant.html)
          ?? variants.find((variant) => variant.status === 'complete' && variant.html)
        if (completedVariant) selectNodePrototypeVariant(nodeId, completedVariant.index)
        prototypeCompleted = didReceivePrototypeHtml
        return prototypeCompleted
      }

      setNodePrototypeVariants(nodeId, Array.from({ length: createVariantCount }, (_, index) => ({ index, html: null, status: 'streaming' as const })))
      let didReceivePrototypeHtml = false
      await streamPrototype(
        settings.proxyBaseUrl,
        requirementState,
        { instruction: effectiveInstruction || undefined, images: referenceImages, numVariants: createVariantCount, assetManifest, signal: abortController.signal },
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
              assetAudit: event.assetAudit,
            })
            if (event.html && useAppStore.getState().nodePrototypeStates[nodeId]?.selectedVariantIndex === -1) {
              selectNodePrototypeVariant(nodeId, event.variantIndex)
            }
          } else if (event.type === 'variantError') {
            prototypeErrorMessage = event.message ?? prototypeErrorMessage
            updateNodePrototypeVariant(nodeId, event.variantIndex, { status: 'error', focus: event.focus, error: event.message })
          }
        },
      )
      if (!didReceivePrototypeHtml) {
        throw new Error(prototypeErrorMessage ?? 'Prototype generation did not return complete HTML.')
      }
      prototypeCompleted = didReceivePrototypeHtml
    } catch (error) {
      if (abortController.signal.aborted || isAbortError(error)) {
        restorePrototypeAfterCancel()
        throw prototypeGenerationCancelledError()
      }
      prototypeErrorMessage = errorMessageFromUnknown(error)
      let result: Awaited<ReturnType<typeof generatePrototype>>
      try {
        result = await generatePrototype(
          settings.proxyBaseUrl,
          requirementState,
          {
            currentHtml: isUpdate ? prototypeBaseHtml : null,
            instruction: effectiveInstruction || undefined,
            images: referenceImages,
            numVariants: isUpdate ? updateVariantCount : createVariantCount,
            variantIndex: isUpdate ? prototypeBaseIndex : undefined,
            history: isUpdate ? prototypeBaseHistory : undefined,
            assetManifest,
            signal: abortController.signal,
          },
        )
      } catch (fallbackError) {
        if (abortController.signal.aborted || isAbortError(fallbackError)) {
          restorePrototypeAfterCancel()
          throw prototypeGenerationCancelledError()
        }
        throw fallbackError
      }

      if (isUpdate) {
        setNodePrototypeVariants(nodeId, result.variants.map((variant) => ({
          index: variant.index,
          html: variant.html,
          status: variant.status,
          focus: variant.focus,
          history: variant.history,
          error: variant.error,
          assetAudit: variant.assetAudit,
        })))
        const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html) ?? result.variants[0]
        if (chosen?.html) {
          selectNodePrototypeVariant(nodeId, chosen.index)
          prototypeCompleted = true
        } else {
          prototypeErrorMessage = chosen?.error ?? prototypeErrorMessage
        }
      } else {
        setNodePrototypeVariants(nodeId, result.variants.map((variant) => ({
          index: variant.index,
          html: variant.html,
          status: variant.status,
          focus: variant.focus,
          history: variant.history,
          error: variant.error,
          assetAudit: variant.assetAudit,
        })))
        const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html)
        if (chosen?.html) {
          selectNodePrototypeVariant(nodeId, chosen.index)
          prototypeCompleted = true
        } else {
          prototypeErrorMessage = result.variants.find((variant) => variant.error)?.error ?? prototypeErrorMessage
        }
      }
    } finally {
      if (shouldRecordInstruction && prototypeCompleted) {
        appendNodeMessage(nodeId, { role: 'assistant', content: 'Updated the right-side prototype preview.' })
      }
      if (prototypeAbortControllerRef.current === abortController) {
        prototypeAbortControllerRef.current = null
        setIsCancellingPrototype(false)
        setIsGeneratingPrototype(false)
      }
    }
    return prototypeCompleted
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
          {nodeComplete ? hasPerformanceRisk ? 'Done / performance risk' : 'Done' : 'Pending polish'}
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
          isCancellingPrototype={isCancellingPrototype}
          nodeOperationSuggestions={nodeOperationSuggestions[nodeId] ?? []}
          performanceSpec={performanceSpec}
          blockingQuestion={performanceSpec?.blockingQuestion ?? null}
          assetWorkbench={assetWorkbench}
          onSend={handleSend}
          onClassifyImageAttachment={handleClassifyImageAttachment}
          onImportFigmaFrame={handleImportFigmaFrame}
          onOpenAssets={() => setAssetWorkbenchOpen(true)}
          onApplyNodeOperationSuggestion={(suggestionId) => applyNodeOperationSuggestion(nodeId, suggestionId)}
          onDismissNodeOperationSuggestion={(suggestionId) => dismissNodeOperationSuggestion(nodeId, suggestionId)}
          onGeneratePrototype={handleGeneratePrototype}
          onCancelPrototypeGeneration={handleCancelPrototypeGeneration}
          onRestorePrototype={(id) => restoreNodePrototypeVersion(nodeId, id)}
          onClearPrototypeHistory={() => clearNodePrototypeHistory(nodeId)}
          onSelectVariant={(index) => selectNodePrototypeVariant(nodeId, index)}
          onRemoveLastTurn={() => removeLastNodeChatTurn(nodeId)}
          onClearChat={() => clearNodeChat(nodeId)}
        />
      </main>
      <AssetWorkbenchModal
        isOpen={assetWorkbenchOpen}
        baseUrl={settings.proxyBaseUrl}
        onClose={() => setAssetWorkbenchOpen(false)}
      />
    </div>
  )
}
