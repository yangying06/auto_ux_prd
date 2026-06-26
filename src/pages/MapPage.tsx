import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { getAiEnvironmentConfig, previewDecomposition, startDecomposition, pollDecomposition, exportSpecFolder, exportNodeMarkdown, suggestPrdNodeOperations, scanProjectBaseline } from '../lib/api'
import type { DecompositionSourcePayload } from '../lib/api'
import { MapAdjustmentPanel } from '../components/map/MapAdjustmentPanel'
import type { PrdImportPreview, PrdNode, PrdNodeOperationSuggestion, PrdNodeReference, PrdTree } from '../types/prdNode'
import type { AiEnvironmentConfig } from '../types/chat'
import { useAppStore } from '../store/appStore'
import { UploadCard } from '../components/upload/UploadCard'
import { DecompProgress } from '../components/upload/DecompProgress'
import { DecompLiveCanvas } from '../components/upload/DecompLiveCanvas'
import { ImportPreview } from '../components/upload/ImportPreview'
import { PrototypePreviewSurface } from '../components/state/PrototypeSandboxPreview'
import { TopAppBar } from '../components/map/TopAppBar'
import { TreeCanvas } from '../components/map/TreeCanvas'
import { PreviewDrawer } from '../components/map/PreviewDrawer'
import { buildProjectArchiveFile, encodeProjectArchive } from '../lib/archiveCodec'
import { formatProjectArchiveError, openProjectArchiveFile, saveProjectArchiveBytes } from '../lib/archiveIO'
import { createProjectWorkspaceSnapshot } from '../lib/archiveSnapshot'
import { AddNodeModal, type AddNodePayload } from '../components/map/AddNodeModal'
import { collectDeliveryNodes, isDeliveryNode } from '../lib/prdNodeDelivery'
import { EnvironmentConfigModal } from '../components/map/EnvironmentConfigModal'
import { AssetWorkbenchModal } from '../components/map/AssetWorkbenchModal'
import type { AssetWorkbenchState } from '../types/assetWorkbench'
import type { ProjectBaselineScan, ProjectIterationContext, ProjectWorkflowMode } from '../types/projectWorkflow'

type Stage = 'upload' | 'preview' | 'decomposing' | 'error' | 'map'

const INITIAL_STEP = '正在建立原文索引'
const POLL_INTERVAL_MS = 700
const EMPTY_NODE_SUGGESTIONS: PrdNodeOperationSuggestion[] = []

function buildImportSourceDocumentText(sources: DecompositionSourcePayload) {
  const figmaUrl = sources.figmaUrl?.trim()
  const mdText = sources.mdText?.trim()
  const parts: string[] = []

  if (figmaUrl) {
    parts.push(`# Figma 设计稿链接\n\n${figmaUrl}`)
  }

  if (mdText) {
    const filename = sources.mdFilename?.trim() || 'Markdown PRD'
    parts.push(`# Markdown PRD：${filename}\n\n${mdText}`)
  }

  return parts.join('\n\n---\n\n')
}

function buildImportSourceFilename(sources: DecompositionSourcePayload) {
  const hasFigma = Boolean(sources.figmaUrl?.trim())
  const mdFilename = sources.mdFilename?.trim()
  if (hasFigma && mdFilename) return `figma+${mdFilename}`
  if (hasFigma) return 'figma-design.md'
  return mdFilename || 'prd.md'
}

function buildIterationSourceText(sources: DecompositionSourcePayload) {
  return [
    sources.figmaUrl?.trim() ? `Figma 设计稿：${sources.figmaUrl.trim()}` : null,
    sources.mdText?.trim() ? sources.mdText.trim() : null,
  ].filter(Boolean).join('\n\n')
}

interface FlowConnectionDraft {
  isOpen: boolean
  mode: 'incoming' | 'outgoing' | 'edge'
  sourceNodeId: string
  targetNodeId: string
  originalSourceNodeId: string | null
  originalTargetNodeId: string | null
  label: string
  reason: string
}

interface CanvasConnectionDraft {
  nodeId: string
  direction: 'incoming' | 'outgoing'
}

function compactText(value: string | null | undefined, maxLength = 72) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function nodeInteractionHint(node: PrdNode) {
  return compactText(
    node.sections?.interaction?.summary
    ?? node.sections?.interaction?.content
    ?? node.sections?.view?.summary
    ?? node.summary
    ?? node.content,
  )
}

function buildSmartReference(sourceNode: PrdNode, targetNode: PrdNode): PrdNodeReference {
  const sourceHint = nodeInteractionHint(sourceNode)
  const targetHint = nodeInteractionHint(targetNode)
  const label = `${sourceNode.label} → ${targetNode.label}`
  const reasonParts = [
    `${sourceNode.label} 触发后进入 ${targetNode.label}。`,
    sourceHint ? `源界面线索：${sourceHint}` : '',
    targetHint ? `目标界面线索：${targetHint}` : '',
  ].filter(Boolean)

  return {
    targetNodeId: targetNode.id,
    label,
    reason: reasonParts.join(' '),
    sourceNodeId: sourceNode.id,
  }
}

function buildInterfaceFlowDisplayTree(tree: PrdTree): PrdTree {
  return Object.fromEntries(
    collectDeliveryNodes(tree).map((node) => [
      node.id,
      {
        ...node,
        parentId: null,
        children: [],
      },
    ]),
  ) as PrdTree
}

function findLastActiveIdx(steps: Array<{ status: string }>) {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'active') return i
  }
  return -1
}

function normalizeStepPhase(label: string) {
  return label
    .replace(/（已等待 \d+ 秒，AI 正在分析原文）$/, '')
    .replace(/（\d+\/\d+）$/, '')
    .replace(/[.。…]+$/, '')
    .trim()
}

function completionGateNodes(tree: PrdTree) {
  const deliveryNodes = collectDeliveryNodes(tree)
  if (deliveryNodes.length) return deliveryNodes
  const nodes = Object.values(tree)
  const leaves = nodes.filter((node) => node.children.length === 0)
  return leaves.length ? leaves : nodes
}

function allCompletionGateNodesDone(tree: PrdTree) {
  const targets = completionGateNodes(tree)
  return targets.length > 0 && targets.every((node) => node.status === 'done')
}

function clipNodeSourceText(text: string) {
  const trimmed = text.trim()
  if (trimmed.length <= 5000) return trimmed
  return `${trimmed.slice(0, 5000)}\n\n[资料内容较长，节点预览仅保留前半部分，AI 分析文本也按附件上限截断]`
}

function buildAddedNodeContent(title: string, supplementText: string, sources: AddNodePayload['sources']) {
  const sections = [
    `# ${title}`,
    '## 节点目标',
    supplementText.trim() || '待基于补充资料完善页面目标、交互范围和验收点。',
  ]

  if (sources.length) {
    sections.push(
      '## 用户提供资料',
      ...sources.map((source) => `### ${source.name}\n\n${clipNodeSourceText(source.text)}`),
    )
  }

  sections.push('## View / Flow / Data', '等待 AI 建议或人工补齐画面、操作、数据三类细节；服务端依赖记录到服务端交互内容中。')
  return sections.join('\n\n')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function hasProjectData(tree: PrdTree | null, sourceDocument: unknown) {
  return Boolean(sourceDocument) || Object.keys(tree ?? {}).length > 0
}

function defaultArchiveFilename(projectName: string, sourceFilename?: string | null) {
  const sourceBase = sourceFilename?.replace(/\.[^.]+$/u, '') ?? projectName
  const safeName = (sourceBase || projectName || 'promptforge-project')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safeName || 'promptforge-project'}-${new Date().toISOString().slice(0, 10)}.gpf`
}

function collectGeneratedNodePrototypes(tree: PrdTree, nodePrototypeStates: ReturnType<typeof useAppStore.getState>['nodePrototypeStates']) {
  return collectDeliveryNodes(tree)
    .sort((a, b) => a.level - b.level || a.order - b.order || a.id.localeCompare(b.id))
    .map((node) => {
      const state = nodePrototypeStates[node.id]
      const selectedVariant = state?.prototypeVariants.find((variant) => variant.index === state.selectedVariantIndex)
      const html = selectedVariant?.html ?? state?.prototypeHtml ?? null
      return html ? { node, html } : null
    })
    .filter((item): item is { node: PrdNode; html: string } => Boolean(item))
}

function buildNodePreviewHtmlMap(nodePrototypeStates: ReturnType<typeof useAppStore.getState>['nodePrototypeStates']) {
  return Object.fromEntries(
    Object.entries(nodePrototypeStates)
      .map(([nodeId, state]) => {
        const selectedVariant = state.prototypeVariants.find((variant) => (
          variant.index === state.selectedVariantIndex && Boolean(variant.html)
        ))
        const html = selectedVariant?.html ?? state.prototypeHtml ?? null
        return html ? [nodeId, html] : null
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  )
}

function countExportableAssetRows(assetWorkbench: AssetWorkbenchState) {
  const uiCount = assetWorkbench.uiRows.filter((row) => row.status === 'ready' && row.result).length
  const effectCount = assetWorkbench.effectRows.filter((row) =>
    row.loadStatus === 'loaded' || Boolean(row.loadedPath) || row.files.length > 0
  ).length
  const audioCount = assetWorkbench.audioRows.filter((row) =>
    row.loadStatus === 'loaded' || Boolean(row.loadedPath) || row.files.length > 0
  ).length
  return uiCount + effectCount + audioCount
}

function buildPlatformStrategyNotes(scan: ProjectBaselineScan) {
  return scan.platforms.map((platform) => `${platform.platform}: ${platform.strategy}`)
}

function buildIterationAcceptanceFocus(scan: ProjectBaselineScan) {
  const evidenceKinds = Array.from(new Set(scan.evidence.map((item) => item.kind))).filter(Boolean)
  return [
    '只生成本次迭代 PRD 命中的界面节点',
    '代码证据只挂在界面节点详情中，不生成代码结构导图',
    '标出当前现状、本次变更、影响范围、资源/文案/数据变更和待确认问题',
    evidenceKinds.length ? `重点回归证据类型：${evidenceKinds.join(' / ')}` : '若缺少代码证据，先要求用户确认目标界面',
  ]
}

function compactIterationContext(context: ProjectIterationContext | null | undefined) {
  if (!context) return null
  const scan = context.baselineScan
  return {
    codebasePath: context.codebasePath,
    focus: context.focus,
    platforms: scan?.platforms.map((item) => `${item.platform} ${item.confidence}%`) ?? [],
    evidenceCount: scan?.evidence.length ?? 0,
    queryTerms: scan?.queryTerms.slice(0, 8) ?? [],
  }
}

export function MapPage() {
  const [stage, setStage] = useState<Stage>(() =>
    Object.keys(useAppStore.getState().prdTree ?? {}).length > 0 ? 'map' : 'upload'
  )
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [decompError, setDecompError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [pendingImportSources, setPendingImportSources] = useState<DecompositionSourcePayload | null>(null)
  const [importPreview, setImportPreview] = useState<PrdImportPreview | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [isAddNodeModalOpen, setIsAddNodeModalOpen] = useState(false)
  const [addNodeParentId, setAddNodeParentId] = useState<string | null>(null)
  const [createdAddNodeId, setCreatedAddNodeId] = useState<string | null>(null)
  const [addNodeError, setAddNodeError] = useState<string | null>(null)
  const [addNodeAssistantReply, setAddNodeAssistantReply] = useState<string | null>(null)
  const [isAddNodeSubmitting, setIsAddNodeSubmitting] = useState(false)
  const [isPrototypeModalOpen, setIsPrototypeModalOpen] = useState(false)
  const [selectedPrototypeNodeId, setSelectedPrototypeNodeId] = useState<string | null>(null)
  const [environmentConfigOpen, setEnvironmentConfigOpen] = useState(false)
  const [assetWorkbenchOpen, setAssetWorkbenchOpen] = useState(false)
  const [environmentStatus, setEnvironmentStatus] = useState<AiEnvironmentConfig | null>(null)
  const [flowConnectionDraft, setFlowConnectionDraft] = useState<FlowConnectionDraft | null>(null)
  const [canvasConnectionDraft, setCanvasConnectionDraft] = useState<CanvasConnectionDraft | null>(null)
  const [canvasFocusNodeId, setCanvasFocusNodeId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInFlightRef = useRef(false)
  const previewRequestRef = useRef(0)

  const [, navigate] = useLocation()

  const prdTree = useAppStore((s) => s.prdTree)
  const settings = useAppStore((s) => s.settings)
  const sourceDocument = useAppStore((s) => s.sourceDocument)
  const projectWorkflow = useAppStore((s) => s.projectWorkflow)
  const currentArchivePath = useAppStore((s) => s.currentArchivePath)
  const archiveDirty = useAppStore((s) => s.archiveDirty)
  const nodePrototypeStates = useAppStore((s) => s.nodePrototypeStates)
  const assetWorkbench = useAppStore((s) => s.assetWorkbench)
  const qaIssues = useAppStore((s) => s.qaIssues)
  const decompositionSteps = useAppStore((s) => s.decompositionSteps)
  const setDecompositionStatus = useAppStore((s) => s.setDecompositionStatus)
  const appendDecompositionStep = useAppStore((s) => s.appendDecompositionStep)
  const updateDecompositionStep = useAppStore((s) => s.updateDecompositionStep)
  const resetDecomposition = useAppStore((s) => s.resetDecomposition)
  const setPrdTree = useAppStore((s) => s.setPrdTree)
  const setSourceDocument = useAppStore((s) => s.setSourceDocument)
  const setProjectWorkflowMode = useAppStore((s) => s.setProjectWorkflowMode)
  const setProjectIterationContext = useAppStore((s) => s.setProjectIterationContext)
  const loadArchiveSnapshot = useAppStore((s) => s.loadArchiveSnapshot)
  const markArchiveSaved = useAppStore((s) => s.markArchiveSaved)
  const resetProject = useAppStore((s) => s.resetProject)
  const createPageNode = useAppStore((s) => s.createPageNode)
  const updateNode = useAppStore((s) => s.updateNode)
  const updateNodeContent = useAppStore((s) => s.updateNodeContent)
  const deleteNode = useAppStore((s) => s.deleteNode)
  const createQaIssue = useAppStore((s) => s.createQaIssue)
  const applyMapAdjustmentOperations = useAppStore((s) => s.applyMapAdjustmentOperations)
  const setNodeOperationSuggestions = useAppStore((s) => s.setNodeOperationSuggestions)
  const dismissNodeOperationSuggestion = useAppStore((s) => s.dismissNodeOperationSuggestion)
  const applyNodeOperationSuggestion = useAppStore((s) => s.applyNodeOperationSuggestion)
  const setNodeDocPath = useAppStore((s) => s.setNodeDocPath)
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId)
  const canvasNodePositions = useAppStore((s) => s.canvasNodePositions)
  const setCanvasNodePosition = useAppStore((s) => s.setCanvasNodePosition)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const addNodeSuggestions = useAppStore((s) => (
    createdAddNodeId ? s.nodeOperationSuggestions[createdAddNodeId] ?? EMPTY_NODE_SUGGESTIONS : EMPTY_NODE_SUGGESTIONS
  ))

  const clearPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    pollInFlightRef.current = false
  }

  const clearImportUiState = () => {
    previewRequestRef.current += 1
    setUploadError(null)
    setDecompError(null)
    setPreviewError(null)
    setProjectError(null)
    setImportPreview(null)
    setPendingImportSources(null)
    setIsPreviewLoading(false)
    setNodeCount(0)
  }

  const confirmProjectClose = (actionLabel: string) => {
    if (!archiveDirty || !hasProjectData(prdTree, sourceDocument)) return true
    return window.confirm(`当前项目有未保存修改。确定要${actionLabel}吗？`)
  }

  const handleSaveArchive = async (saveAs = false) => {
    if (!hasProjectData(prdTree, sourceDocument)) {
      setProjectError('当前没有可保存的项目。')
      return
    }

    setProjectError(null)
    try {
      const snapshot = createProjectWorkspaceSnapshot(useAppStore.getState())
      const archive = buildProjectArchiveFile(snapshot)
      const bytes = encodeProjectArchive(archive)
      const result = await saveProjectArchiveBytes({
        bytes,
        defaultFilename: defaultArchiveFilename(settings.projectName, sourceDocument?.filename),
        currentPath: currentArchivePath,
        saveAs,
      })
      if (result.status === 'saved') {
        markArchiveSaved(result.path, archive.manifest.savedAt)
      }
    } catch (err) {
      setProjectError(formatProjectArchiveError(err, '保存项目存档失败'))
    }
  }

  const handleOpenArchive = async () => {
    if (!confirmProjectClose('打开其他存档')) return
    clearPolling()
    setProjectError(null)
    try {
      const archive = await openProjectArchiveFile()
      if (!archive) return
      loadArchiveSnapshot(archive.workspace, archive.path, archive.manifest.savedAt)
      clearImportUiState()
      sessionIdRef.current = null
      const hasTree = Object.keys(archive.workspace.prdTree ?? {}).length > 0
      setStage(hasTree ? 'map' : 'upload')
      navigate('/')
    } catch (err) {
      setProjectError(formatProjectArchiveError(err, '打开项目存档失败'))
    }
  }

  const handleNewProject = () => {
    if (!confirmProjectClose('新建项目')) return
    clearPolling()
    sessionIdRef.current = null
    resetProject()
    clearImportUiState()
    setStage('upload')
    navigate('/')
  }

  const handleDeleteProject = () => {
    if (!hasProjectData(prdTree, sourceDocument)) return
    const suffix = currentArchivePath ? '这不会删除磁盘上的本地存档文件。' : '当前项目数据会从工作区清空。'
    if (!window.confirm(`确定删除当前项目吗？${suffix}`)) return
    clearPolling()
    sessionIdRef.current = null
    resetProject()
    clearImportUiState()
    setStage('upload')
    navigate('/')
  }

  const startPolling = (sessionId: string) => {
    clearPolling()
    // Initialize to the label we pre-added so first poll doesn't duplicate it
    let lastStep = INITIAL_STEP

    pollIntervalRef.current = setInterval(async () => {
      if (pollInFlightRef.current || sessionIdRef.current !== sessionId) return
      pollInFlightRef.current = true
      try {
        const data = await pollDecomposition(settings.proxyBaseUrl, sessionId)
        if (sessionIdRef.current !== sessionId) return

        setNodeCount(data.nodeCount)

        if (data.nodes.length > 0) {
          const nodeMap = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
          setPrdTree(nodeMap)
        }

        // Advance step display when server moves to a new step
        if (data.currentStep !== lastStep) {
          const currentSteps = useAppStore.getState().decompositionSteps
          const activeIdx = findLastActiveIdx(currentSteps)
          const activeStep = activeIdx >= 0 ? currentSteps[activeIdx] : null
          const samePhase = activeStep
            ? normalizeStepPhase(activeStep.label) === normalizeStepPhase(data.currentStep)
            : false

          if (data.status === 'running' && samePhase && activeIdx >= 0) {
            updateDecompositionStep(activeIdx, { label: data.currentStep, status: 'active' })
          } else {
            if (activeIdx >= 0) updateDecompositionStep(activeIdx, { status: data.status === 'error' ? 'error' : 'complete' })
          }

          if (data.status === 'running' && !samePhase) {
            appendDecompositionStep({ label: data.currentStep, status: 'active' })
          }
          lastStep = data.currentStep
        }

        if (data.status === 'done') {
          clearPolling()
          const finalSteps = useAppStore.getState().decompositionSteps
          const activeIdx = findLastActiveIdx(finalSteps)
          if (activeIdx >= 0) updateDecompositionStep(activeIdx, { status: 'complete' })
          appendDecompositionStep({ label: '分析完成', status: 'complete' })

          if (data.nodes.length === 0) {
            setDecompError('分析完成但没有生成任何导图节点，请检查 PRD 是否包含可读取文本。')
            setDecompositionStatus('error')
            setStage('error')
            return
          }

          const finalTree = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
          setPrdTree(finalTree)
          setDecompositionStatus('done')
          setSelectedNodeId(null)
          setStage('map')
        }

        if (data.status === 'error') {
          clearPolling()
          const errSteps = useAppStore.getState().decompositionSteps
          const activeIdx = findLastActiveIdx(errSteps)
          if (activeIdx >= 0) updateDecompositionStep(activeIdx, { status: 'error' })

          setDecompError(data.error ?? 'AI未返回有效的树形结构，请重新上传。')
          setDecompositionStatus('error')
          setStage('error')
        }
      } catch (err) {
        if (sessionIdRef.current !== sessionId) return
        clearPolling()
        setDecompError(err instanceof Error ? err.message : '轮询失败')
        setDecompositionStatus('error')
        setStage('error')
      } finally {
        if (sessionIdRef.current === sessionId) pollInFlightRef.current = false
      }
    }, POLL_INTERVAL_MS)
  }

  const beginDecomposition = async (sources: DecompositionSourcePayload) => {
    clearPolling()
    sessionIdRef.current = null
    resetDecomposition()
    setUploadError(null)
    setDecompError(null)
    setNodeCount(0)
    setStage('decomposing')
    setDecompositionStatus('decomposing')
    appendDecompositionStep({ label: INITIAL_STEP, status: 'active' })

    try {
      const { sessionId } = await startDecomposition(settings.proxyBaseUrl, sources, useAppStore.getState().projectWorkflow)
      sessionIdRef.current = sessionId
      startPolling(sessionId)
    } catch (err) {
      setDecompError(err instanceof Error ? err.message : '无法启动拆解任务')
      setStage('error')
      setDecompositionStatus('error')
    }
  }

  const handleImportSources = async (sources: DecompositionSourcePayload) => {
    const sourceText = buildImportSourceDocumentText(sources)
    if (!sourceText.trim()) {
      setUploadError('请至少提供 Figma 链接或 Markdown PRD 文档。')
      return
    }

    const workflowBeforeReset = useAppStore.getState().projectWorkflow
    const iterationDraft = workflowBeforeReset.iteration
    const isIterationMode = workflowBeforeReset.mode === 'existing_project_iteration'
    const codebasePath = iterationDraft?.codebasePath.trim() ?? ''
    const focus = iterationDraft?.focus.trim() ?? ''

    if (isIterationMode && !codebasePath) {
      setUploadError('已有项目迭代需要先填写代码库路径。')
      return
    }

    clearPolling()
    sessionIdRef.current = null
    resetProject()
    resetDecomposition()
    setUploadError(null)
    setDecompError(null)
    setProjectError(null)
    setNodeCount(0)
    setSourceDocument({
      filename: buildImportSourceFilename(sources),
      text: sourceText,
      importedAt: new Date().toISOString(),
    })
    setPendingImportSources(sources)
    setImportPreview(null)
    setPreviewError(null)
    setIsPreviewLoading(true)
    setStage('preview')
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId

    try {
      if (isIterationMode) {
        const iterationSourceText = buildIterationSourceText(sources)
        const baselineScan = await scanProjectBaseline(settings.proxyBaseUrl, {
          rootPath: codebasePath,
          iterationPrd: iterationSourceText,
          focus,
        })
        const iterationContext: ProjectIterationContext = {
          codebasePath,
          focus,
          baselineScan,
          platformStrategyNotes: buildPlatformStrategyNotes(baselineScan),
          acceptanceFocus: buildIterationAcceptanceFocus(baselineScan),
        }
        setProjectIterationContext(iterationContext)
      } else {
        setProjectWorkflowMode('new_project')
      }

      const preview = await previewDecomposition(settings.proxyBaseUrl, sources, useAppStore.getState().projectWorkflow)
      if (previewRequestRef.current !== requestId) return
      setImportPreview(preview)
    } catch (err) {
      if (previewRequestRef.current !== requestId) return
      setPreviewError(err instanceof Error ? err.message : '无法建立导入预览')
    } finally {
      if (previewRequestRef.current === requestId) setIsPreviewLoading(false)
    }
  }

  const handleConfirmPreview = () => {
    if (!pendingImportSources) return
    void beginDecomposition(pendingImportSources)
  }

  const handleWorkflowModeChange = (mode: ProjectWorkflowMode) => {
    setProjectWorkflowMode(mode)
  }

  const handleIterationCodebasePathChange = (codebasePath: string) => {
    const current = useAppStore.getState().projectWorkflow.iteration
    setProjectIterationContext({
      codebasePath,
      focus: current?.focus ?? '',
      baselineScan: null,
      platformStrategyNotes: current?.platformStrategyNotes ?? [],
      acceptanceFocus: current?.acceptanceFocus ?? [],
    })
  }

  const handleIterationFocusChange = (focus: string) => {
    const current = useAppStore.getState().projectWorkflow.iteration
    setProjectIterationContext({
      codebasePath: current?.codebasePath ?? '',
      focus,
      baselineScan: null,
      platformStrategyNotes: current?.platformStrategyNotes ?? [],
      acceptanceFocus: current?.acceptanceFocus ?? [],
    })
  }

  const handleReset = () => {
    clearPolling()
    sessionIdRef.current = null
    resetProject()
    clearImportUiState()
    setStage('upload')
    setIsAddNodeModalOpen(false)
    setAddNodeParentId(null)
    setCreatedAddNodeId(null)
    setAddNodeError(null)
    setAddNodeAssistantReply(null)
    setIsAddNodeSubmitting(false)
    setIsPrototypeModalOpen(false)
    setSelectedPrototypeNodeId(null)
  }

  useEffect(() => {
    let cancelled = false
    getAiEnvironmentConfig(settings.proxyBaseUrl)
      .then((status) => {
        if (cancelled) return
        setEnvironmentStatus(status)
        if (!status.aiConfigured) setEnvironmentConfigOpen(true)
      })
      .catch(() => {
        if (!cancelled) setEnvironmentStatus(null)
      })
    return () => { cancelled = true }
  }, [settings.proxyBaseUrl])

  const environmentConfigModal = (
    <EnvironmentConfigModal
      open={environmentConfigOpen}
      required={environmentStatus ? !environmentStatus.aiConfigured : false}
      baseUrl={settings.proxyBaseUrl}
      status={environmentStatus}
      onSaved={setEnvironmentStatus}
      onClose={() => setEnvironmentConfigOpen(false)}
    />
  )

  useEffect(() => {
    return () => { clearPolling() }
  }, [])

  useEffect(() => {
    if (!canvasFocusNodeId) return
    if (prdTree?.[canvasFocusNodeId]) return
    setCanvasFocusNodeId(null)
  }, [canvasFocusNodeId, prdTree])

  if (stage === 'map' && prdTree) {
    const nodePreviewHtmlMap = buildNodePreviewHtmlMap(nodePrototypeStates)
    const displayTree = buildInterfaceFlowDisplayTree(prdTree)
    const selectedNode = selectedNodeId && displayTree[selectedNodeId] ? (prdTree[selectedNodeId] ?? null) : null

    const completionTargets = completionGateNodes(prdTree)
    const incompleteCompletionTargets = completionTargets.filter((node) => node.status !== 'done')
    const generatedNodePrototypes = collectGeneratedNodePrototypes(prdTree, nodePrototypeStates)
    const selectedNodePrototype = generatedNodePrototypes.find((item) => item.node.id === selectedPrototypeNodeId)
      ?? generatedNodePrototypes[0]
    const canExport = allCompletionGateNodesDone(prdTree)
    const canValidatePrototype = completionTargets.length > 0
    const hasProject = hasProjectData(prdTree, sourceDocument)
    const topError = exportError ?? projectError
    const qaOpenIssueCount = Object.values(qaIssues).filter((issue) => issue.status !== 'draft' && issue.status !== 'closed').length
    const iterationInfo = projectWorkflow.mode === 'existing_project_iteration'
      ? compactIterationContext(projectWorkflow.iteration)
      : null
    const connectableNodes = collectDeliveryNodes(prdTree)
    const fallbackConnectableNode = (excludeNodeId?: string | null) => (
      connectableNodes.find((node) => node.id !== excludeNodeId) ?? connectableNodes[0] ?? null
    )
    const connectableNodeIds = connectableNodes.map((node) => node.id)

    const startCanvasConnection = (nodeId: string, direction: 'incoming' | 'outgoing') => {
      if (!prdTree[nodeId] || !connectableNodeIds.includes(nodeId)) return
      setCanvasFocusNodeId(nodeId)
      setSelectedNodeId(null)
      setFlowConnectionDraft(null)
      setCanvasConnectionDraft({ nodeId, direction })
    }

    const cancelCanvasConnection = () => {
      setCanvasConnectionDraft(null)
    }

    const completeCanvasConnection = (clickedNodeId: string) => {
      if (!canvasConnectionDraft) return
      if (!connectableNodeIds.includes(clickedNodeId) || clickedNodeId === canvasConnectionDraft.nodeId) return

      const sourceNodeId = canvasConnectionDraft.direction === 'outgoing' ? canvasConnectionDraft.nodeId : clickedNodeId
      const targetNodeId = canvasConnectionDraft.direction === 'outgoing' ? clickedNodeId : canvasConnectionDraft.nodeId
      const sourceNode = prdTree[sourceNodeId]
      const targetNode = prdTree[targetNodeId]
      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return

      const smartReference = buildSmartReference(sourceNode, targetNode)
      const existing = (sourceNode.references ?? []).find((reference) => reference.targetNodeId === targetNode.id)
      const references = (sourceNode.references ?? []).filter((reference) => reference.targetNodeId !== targetNode.id)
      updateNode(sourceNode.id, {
        references: [
          ...references,
          {
            ...smartReference,
            label: existing?.label?.trim() || smartReference.label,
            reason: existing?.reason?.trim() || smartReference.reason,
          },
        ],
      })
      setCanvasFocusNodeId(canvasConnectionDraft.nodeId)
      setSelectedNodeId(null)
      setCanvasConnectionDraft(null)
    }

    const openFlowConnectionDraft = (nodeId: string, direction: 'incoming' | 'outgoing') => {
      const fallback = fallbackConnectableNode(nodeId)
      if (!fallback) return
      const sourceNodeId = direction === 'outgoing' ? nodeId : fallback.id
      const targetNodeId = direction === 'outgoing' ? fallback.id : nodeId
      const sourceNode = prdTree[sourceNodeId]
      const targetNode = prdTree[targetNodeId]
      if (!sourceNode || !targetNode || sourceNodeId === targetNodeId) return
      const existing = (sourceNode.references ?? []).find((reference) => reference.targetNodeId === targetNodeId)

      setFlowConnectionDraft({
        isOpen: true,
        mode: direction,
        sourceNodeId,
        targetNodeId,
        originalSourceNodeId: existing ? sourceNodeId : null,
        originalTargetNodeId: existing?.targetNodeId ?? null,
        label: existing?.label ?? `${sourceNode.label} → ${targetNode.label}`,
        reason: existing?.reason ?? '',
      })
    }

    const openExistingReferenceDraft = (sourceNodeId: string, targetNodeId: string) => {
      const sourceNode = prdTree[sourceNodeId]
      const targetNode = prdTree[targetNodeId]
      if (!sourceNode || !targetNode) return
      const existing = (sourceNode.references ?? []).find((reference) => reference.targetNodeId === targetNodeId)

      setFlowConnectionDraft({
        isOpen: true,
        mode: 'edge',
        sourceNodeId,
        targetNodeId,
        originalSourceNodeId: sourceNodeId,
        originalTargetNodeId: targetNodeId,
        label: existing?.label ?? `${sourceNode.label} → ${targetNode.label}`,
        reason: existing?.reason ?? '',
      })
    }

    const closeFlowConnectionDraft = () => {
      setFlowConnectionDraft(null)
    }

    const saveFlowConnectionDraft = () => {
      if (!flowConnectionDraft) return
      const sourceNode = prdTree[flowConnectionDraft.sourceNodeId]
      const targetNode = prdTree[flowConnectionDraft.targetNodeId]
      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return

      const nextReference: PrdNodeReference = {
        targetNodeId: targetNode.id,
        label: flowConnectionDraft.label.trim() || `${sourceNode.label} → ${targetNode.label}`,
        reason: flowConnectionDraft.reason.trim() || null,
        sourceNodeId: sourceNode.id,
      }

      if (flowConnectionDraft.originalSourceNodeId && flowConnectionDraft.originalSourceNodeId !== sourceNode.id) {
        const originalSource = prdTree[flowConnectionDraft.originalSourceNodeId]
        if (originalSource) {
          updateNode(originalSource.id, {
            references: (originalSource.references ?? []).filter((reference) => (
              reference.targetNodeId !== flowConnectionDraft.originalTargetNodeId
            )),
          })
        }
      }

      const references = (sourceNode.references ?? []).filter((reference) => (
        reference.targetNodeId !== targetNode.id
        && !(flowConnectionDraft.originalSourceNodeId === sourceNode.id && reference.targetNodeId === flowConnectionDraft.originalTargetNodeId)
      ))
      updateNode(sourceNode.id, { references: [...references, nextReference] })
      setCanvasFocusNodeId(sourceNode.id)
      setSelectedNodeId(null)
      closeFlowConnectionDraft()
    }

    const deleteFlowConnectionDraft = () => {
      if (!flowConnectionDraft?.originalSourceNodeId || !flowConnectionDraft.originalTargetNodeId) return
      const sourceNode = prdTree[flowConnectionDraft.originalSourceNodeId]
      if (!sourceNode) return
      updateNode(sourceNode.id, {
        references: (sourceNode.references ?? []).filter((reference) => reference.targetNodeId !== flowConnectionDraft.originalTargetNodeId),
      })
      closeFlowConnectionDraft()
    }

    const handleExport = async () => {
      setIsExporting(true)
      setExportError(null)
      try {
        const exportableAssetCount = countExportableAssetRows(assetWorkbench)
        const includeAssets = exportableAssetCount > 0
          ? window.confirm(`检测到 ${exportableAssetCount} 组项目素材。\n\n选择“确定”：导出制作文档并附带素材。\n选择“取消”：只导出制作文档。`)
          : false
        const result = await exportSpecFolder(settings.proxyBaseUrl, prdTree, {
          includeAssets,
          assetWorkbench,
        })
        for (const doc of result.documents) {
          setNodeDocPath(doc.nodeId, doc.docPath)
        }
        const assetSummary = includeAssets && result.assets
          ? `\n素材清单：${result.assets.manifestPath}\n已复制文件：${result.assets.copiedFiles} 个，跳过：${result.assets.skippedItems} 项`
          : ''
        alert(`已导出页面级 spec 文件夹：${result.exportDir}${assetSummary}`)
      } catch (err) {
        setExportError(err instanceof Error ? err.message : '导出失败，请重试')
      } finally {
        setIsExporting(false)
      }
    }

    const handleOpenAddNode = (parentId: string | null) => {
      setAddNodeParentId(parentId)
      setCreatedAddNodeId(null)
      setAddNodeError(null)
      setAddNodeAssistantReply(null)
      setIsAddNodeModalOpen(true)
    }

    const handleCloseAddNode = () => {
      if (createdAddNodeId) setNodeOperationSuggestions(createdAddNodeId, [])
      setIsAddNodeModalOpen(false)
      setAddNodeParentId(null)
      setCreatedAddNodeId(null)
      setAddNodeError(null)
      setAddNodeAssistantReply(null)
      setIsAddNodeSubmitting(false)
    }

    const handleCreatePage = async (payload: AddNodePayload) => {
      const sources = payload.sources.filter((source) => source.text.trim())
      const supplementText = payload.supplementText.trim()
      const hasSourceMaterial = Boolean(supplementText) || sources.length > 0
      const parentId = addNodeParentId && prdTree[addNodeParentId] ? addNodeParentId : null

      setIsAddNodeSubmitting(true)
      setAddNodeError(null)
      setAddNodeAssistantReply(null)
      try {
        const newNodeId = createPageNode({
          title: payload.title,
          parentId,
          summary: hasSourceMaterial
            ? `${payload.title} 页面节点，已附加补充资料，等待确认 View / Flow / Data 拆分。`
            : undefined,
          content: buildAddedNodeContent(payload.title, supplementText, sources),
        })
        if (!newNodeId) throw new Error('无法创建节点，请输入有效名称。')

        setCreatedAddNodeId(newNodeId)
        setCanvasFocusNodeId(newNodeId)
        setSelectedNodeId(null)
        setNodeOperationSuggestions(newNodeId, [])

        if (!hasSourceMaterial) {
          handleCloseAddNode()
          return
        }

        const nextTree = useAppStore.getState().prdTree ?? {}
        const response = await suggestPrdNodeOperations(settings.proxyBaseUrl, {
          tree: nextTree,
          selectedNodeId: newNodeId,
          supplementText: [`新增节点名称：${payload.title}`, supplementText].filter(Boolean).join('\n\n'),
          sources,
        })
        setAddNodeAssistantReply(response.reply)
        setNodeOperationSuggestions(newNodeId, response.suggestions)
        if (!response.suggestions.length) {
          setAddNodeError(response.reply || 'AI 没有返回可应用的 View / Flow / Data 拆分建议。')
        }
      } catch (err) {
        setAddNodeError(err instanceof Error ? err.message : '新增节点失败')
      } finally {
        setIsAddNodeSubmitting(false)
      }
    }

    const handleApplyAddNodeSuggestion = (suggestionId: string) => {
      if (!createdAddNodeId) return
      applyNodeOperationSuggestion(createdAddNodeId, suggestionId)
    }

    const handleDismissAddNodeSuggestion = (suggestionId: string) => {
      if (!createdAddNodeId) return
      dismissNodeOperationSuggestion(createdAddNodeId, suggestionId)
    }

    const handleApplyAllAddNodeSuggestions = () => {
      if (!createdAddNodeId) return
      const ids = addNodeSuggestions.map((suggestion) => suggestion.id)
      for (const suggestionId of ids) {
        applyNodeOperationSuggestion(createdAddNodeId, suggestionId)
      }
      setAddNodeAssistantReply('已应用全部 View / Flow / Data 拆分建议。')
    }

    const handleDeleteNode = (node: PrdNode) => {
      if (window.confirm(`确定删除「${node.label}」及其子节点吗？`)) {
        deleteNode(node.id)
      }
    }

    const handleOpenDoc = async (node: PrdNode) => {
      try {
        const blob = await exportNodeMarkdown(settings.proxyBaseUrl, prdTree, node.id)
        const url = URL.createObjectURL(blob)
        const opened = window.open(url, '_blank')
        if (opened) {
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        } else {
          URL.revokeObjectURL(url)
          downloadBlob(blob, node.docPath?.split('/').pop() ?? `${node.id}.md`)
        }
      } catch (err) {
        setExportError(err instanceof Error ? err.message : '打开文档失败')
      }
    }

    const handleOpenProjectPrototype = () => {
      if (!canValidatePrototype) {
        setExportError('暂无可用于生成 HTML 验证原型的文档包')
        return
      }
      if (!generatedNodePrototypes.length) {
        setExportError('还没有界面节点原型。请先进入具体界面节点，在右侧视觉舱生成原型预览。')
        return
      }

      if (incompleteCompletionTargets.length > 0) {
        const proceed = window.confirm(
          [
            `仍有 ${incompleteCompletionTargets.length} 个文档包未确认。`,
            '',
            'HTML 验证原型会汇总当前已生成的界面节点原型，未确认或未生成原型的节点不会出现在组合预览里。',
            '',
            '是否继续用于早期评审？',
          ].join('\n'),
        )
        if (!proceed) return
      }

      setSelectedPrototypeNodeId((current) => (
        current && generatedNodePrototypes.some((item) => item.node.id === current)
          ? current
          : generatedNodePrototypes[0]?.node.id ?? null
      ))
      setIsPrototypeModalOpen(true)
    }

    const handleOpenQaForNode = (node: PrdNode) => {
      createQaIssue(isDeliveryNode(node, prdTree) ? node.id : null)
      navigate('/qa')
    }

    const handleOpenQaFromToolbar = () => {
      navigate('/qa')
    }

    return (
      <div className="w-full h-screen flex flex-col bg-background animate-fade-in overflow-hidden">
        <TopAppBar
          projectName={settings.projectName}
          archiveDirty={archiveDirty}
          currentArchivePath={currentArchivePath}
          hasProject={hasProject}
          onNewProject={handleNewProject}
          onOpenArchive={() => { void handleOpenArchive() }}
          onSaveArchive={() => { void handleSaveArchive(false) }}
          onSaveArchiveAs={() => { void handleSaveArchive(true) }}
          onConfigureEnvironment={() => setEnvironmentConfigOpen(true)}
          onDeleteProject={handleDeleteProject}
          canExport={canExport}
          onExport={handleExport}
          isExporting={isExporting}
          onValidatePrototype={() => { void handleOpenProjectPrototype() }}
          canValidatePrototype={canValidatePrototype}
          prototypeValidationRiskCount={incompleteCompletionTargets.length}
          onOpenAssets={() => setAssetWorkbenchOpen(true)}
          onOpenQa={handleOpenQaFromToolbar}
          qaOpenIssueCount={qaOpenIssueCount}
        />
        {iterationInfo ? (
          <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-secondary/30 bg-secondary/10 px-lg py-sm text-label-md text-on-surface-variant">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: '18px' }}>difference</span>
            <span className="font-semibold text-secondary">已有项目迭代</span>
            <span className="max-w-[320px] truncate">{iterationInfo.focus || '未填写迭代焦点'}</span>
            <span className="max-w-[360px] truncate font-mono text-code-sm">{iterationInfo.codebasePath}</span>
            <span>{iterationInfo.platforms.join(' / ') || '平台待确认'}</span>
            <span>证据 {iterationInfo.evidenceCount}</span>
          </div>
        ) : null}
        {topError && (
          <div className="bg-error/10 border-b border-error/30 px-lg py-sm text-error font-label-md text-label-md flex items-center gap-sm">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>error</span>
            {topError}
            <button
              onClick={() => {
                setExportError(null)
                setProjectError(null)
              }}
              className="ml-auto text-error/60 hover:text-error cursor-pointer"
              aria-label="关闭错误提示"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
            </button>
          </div>
        )}
        <main className="flex-1 flex overflow-hidden">
          <MapAdjustmentPanel
            baseUrl={settings.proxyBaseUrl}
            tree={prdTree}
            onApply={applyMapAdjustmentOperations}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <TreeCanvas
              tree={displayTree}
              sourceTree={prdTree}
              layoutMode="free"
              selectedNodeId={canvasFocusNodeId}
              canvasNodePositions={canvasNodePositions}
              previewHtmlByNodeId={nodePreviewHtmlMap}
              connectableNodeIds={connectableNodeIds}
              connectionDraft={canvasConnectionDraft}
              onNodeClick={(id) => {
                setCanvasFocusNodeId(id)
                setSelectedNodeId(null)
              }}
              onNodeDoubleClick={(id) => {
                setCanvasFocusNodeId(id)
                setSelectedNodeId(id)
              }}
              onAddNode={handleOpenAddNode}
              onStartConnection={startCanvasConnection}
              onCompleteConnection={completeCanvasConnection}
              onNodePositionCommit={setCanvasNodePosition}
              onCancelConnection={cancelCanvasConnection}
              onOpenConnection={openFlowConnectionDraft}
              onEditReference={openExistingReferenceDraft}
            />
          </div>
          <PreviewDrawer
            node={selectedNode}
            tree={prdTree}
            onClose={() => setSelectedNodeId(null)}
            onDelete={handleDeleteNode}
            onOpenDoc={handleOpenDoc}
            onUpdateContent={updateNodeContent}
            onOpenQa={handleOpenQaForNode}
            onSelectNode={(id) => setSelectedNodeId(id)}
          />
        </main>
        {flowConnectionDraft?.isOpen ? (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-lg backdrop-blur-sm">
            <section className="flex w-[min(720px,96vw)] flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-2xl">
              <header className="flex items-center justify-between gap-md border-b border-outline-variant bg-surface-container-low px-lg py-md">
                <div className="min-w-0">
                  <div className="flex items-center gap-sm text-primary">
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>conversion_path</span>
                    <h2 className="truncate font-headline-sm text-headline-sm text-on-surface">编辑跳转线</h2>
                  </div>
                  <p className="mt-xs text-body-sm text-on-surface-variant">
                    这条线会保存到源界面的 references，用于表达页面跳转、触发条件和设计备注。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeFlowConnectionDraft}
                  className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                  aria-label="关闭跳转线编辑"
                  title="关闭"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </header>

              <div className="grid gap-md px-lg py-md md:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant">源界面</span>
                  <select
                    value={flowConnectionDraft.sourceNodeId}
                    onChange={(event) => {
                      const sourceNodeId = event.target.value
                      const sourceNode = prdTree[sourceNodeId]
                      const targetNode = prdTree[flowConnectionDraft.targetNodeId]
                      setFlowConnectionDraft({
                        ...flowConnectionDraft,
                        sourceNodeId,
                        label: sourceNode && targetNode ? `${sourceNode.label} → ${targetNode.label}` : flowConnectionDraft.label,
                      })
                    }}
                    className="h-10 rounded border border-outline-variant bg-surface-container-low px-sm text-body-sm text-on-surface outline-none focus:border-primary"
                  >
                    {connectableNodes.map((node) => (
                      <option key={node.id} value={node.id}>{node.label}</option>
                    ))}
                  </select>
                </label>

                <label className="flex min-w-0 flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant">目标界面</span>
                  <select
                    value={flowConnectionDraft.targetNodeId}
                    onChange={(event) => {
                      const targetNodeId = event.target.value
                      const sourceNode = prdTree[flowConnectionDraft.sourceNodeId]
                      const targetNode = prdTree[targetNodeId]
                      setFlowConnectionDraft({
                        ...flowConnectionDraft,
                        targetNodeId,
                        label: sourceNode && targetNode ? `${sourceNode.label} → ${targetNode.label}` : flowConnectionDraft.label,
                      })
                    }}
                    className="h-10 rounded border border-outline-variant bg-surface-container-low px-sm text-body-sm text-on-surface outline-none focus:border-primary"
                  >
                    {connectableNodes.map((node) => (
                      <option key={node.id} value={node.id}>{node.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-md px-lg pb-lg">
                <label className="flex min-w-0 flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant">线条标题</span>
                  <input
                    value={flowConnectionDraft.label}
                    onChange={(event) => setFlowConnectionDraft({ ...flowConnectionDraft, label: event.target.value })}
                    placeholder="例如：点击列表按钮打开帮助界面"
                    className="h-10 rounded border border-outline-variant bg-surface-container-low px-sm text-body-sm text-on-surface outline-none focus:border-primary"
                  />
                </label>

                <label className="flex min-w-0 flex-col gap-xs">
                  <span className="font-label-md text-label-md text-on-surface-variant">条件 / 过程 / 备注</span>
                  <textarea
                    value={flowConnectionDraft.reason}
                    onChange={(event) => setFlowConnectionDraft({ ...flowConnectionDraft, reason: event.target.value })}
                    placeholder="例如：主界面点击“列表”先打开列表弹窗；列表中点击“帮助”选项后进入帮助界面。需要保留列表滚动位置。"
                    className="min-h-[120px] rounded border border-outline-variant bg-surface-container-low p-sm text-body-sm leading-relaxed text-on-surface outline-none focus:border-primary"
                  />
                </label>

                {flowConnectionDraft.sourceNodeId === flowConnectionDraft.targetNodeId ? (
                  <div className="rounded border border-error/40 bg-error/10 px-sm py-xs text-body-sm text-error">
                    源界面和目标界面不能相同。
                  </div>
                ) : null}
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant bg-surface-container-low px-lg py-md">
                <div>
                  {flowConnectionDraft.originalSourceNodeId && flowConnectionDraft.originalTargetNodeId ? (
                    <button
                      type="button"
                      onClick={deleteFlowConnectionDraft}
                      className="rounded border border-error/50 px-md py-sm text-label-md text-error transition-colors hover:bg-error/10"
                    >
                      删除这条线
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-sm">
                  <button
                    type="button"
                    onClick={closeFlowConnectionDraft}
                    className="rounded border border-outline-variant px-md py-sm text-label-md text-on-surface-variant transition-colors hover:bg-surface-variant"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={saveFlowConnectionDraft}
                    disabled={flowConnectionDraft.sourceNodeId === flowConnectionDraft.targetNodeId}
                    className="rounded bg-primary px-md py-sm text-label-md text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    保存跳转线
                  </button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}
        <AddNodeModal
          isOpen={isAddNodeModalOpen}
          isSubmitting={isAddNodeSubmitting}
          error={addNodeError}
          assistantReply={addNodeAssistantReply}
          createdNodeLabel={createdAddNodeId ? prdTree[createdAddNodeId]?.label ?? null : null}
          suggestions={addNodeSuggestions}
          onCreate={handleCreatePage}
          onClose={handleCloseAddNode}
          onApplySuggestion={handleApplyAddNodeSuggestion}
          onDismissSuggestion={handleDismissAddNodeSuggestion}
          onApplyAllSuggestions={handleApplyAllAddNodeSuggestions}
        />
        {environmentConfigModal}
        <AssetWorkbenchModal
          isOpen={assetWorkbenchOpen}
          baseUrl={settings.proxyBaseUrl}
          onClose={() => setAssetWorkbenchOpen(false)}
        />
        {isPrototypeModalOpen ? (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-md backdrop-blur-sm md:p-lg">
            <section className="flex h-[92vh] w-[min(1280px,96vw)] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl">
              <header className="flex shrink-0 flex-wrap items-center justify-between gap-md border-b border-outline-variant bg-surface-container-low px-md py-md md:px-lg">
                <div className="min-w-0">
                  <div className="flex items-center gap-sm">
                    <span className="material-symbols-outlined text-tertiary" style={{ fontSize: '20px' }}>preview</span>
                    <h2 className="font-title-md text-title-md text-on-surface">HTML 验证原型</h2>
                  </div>
                  <p className="mt-xs max-w-[960px] text-body-sm text-on-surface-variant">
                    汇总各界面节点已生成的 HTML 原型，用于进入目标平台实现前确认流程、状态和反馈边界；可复用视觉资源仍由 Figma 或资源库提供。
                  </p>
                </div>
                <div className="flex items-center gap-sm">
                  <button
                    type="button"
                    onClick={() => setIsPrototypeModalOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:text-on-surface"
                    aria-label="关闭 HTML 验证原型"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                  </button>
                </div>
              </header>
              <div className="flex shrink-0 gap-xs overflow-x-auto border-b border-outline-variant bg-surface-container-low px-md py-sm md:px-lg">
                {generatedNodePrototypes.map((item) => (
                  <button
                    key={item.node.id}
                    type="button"
                    onClick={() => setSelectedPrototypeNodeId(item.node.id)}
                    className={[
                      'shrink-0 rounded-lg border px-sm py-xs text-label-md transition-colors',
                      selectedNodePrototype?.node.id === item.node.id
                        ? 'border-tertiary bg-tertiary-container text-on-tertiary-container'
                        : 'border-outline-variant bg-surface-container-high text-on-surface-variant hover:text-on-surface',
                    ].join(' ')}
                  >
                    {item.node.label}
                  </button>
                ))}
              </div>
              <div className="flex min-h-0 flex-1 bg-zinc-950 p-sm md:p-md">
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-zinc-950 shadow-inner">
                  <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-40" />
                  <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
                    <PrototypePreviewSurface
                      html={selectedNodePrototype?.html ?? null}
                      title={selectedNodePrototype ? `${selectedNodePrototype.node.label} HTML prototype` : 'HTML prototype'}
                      interactive
                      fit="fullPage"
                      surfaceClassName="h-full w-full"
                      fallback={(
                        <div className="flex h-full items-center justify-center p-md text-center text-body-sm text-on-surface-variant">
                          还没有可展示的界面节点原型。
                        </div>
                      )}
                    />
                  </div>
                </div>
              </div>
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-t border-outline-variant bg-surface-container-low px-md py-sm text-label-md text-on-surface-variant md:px-lg">
                <div className="min-w-0 truncate">
                  当前展示：{selectedNodePrototype?.node.label ?? '无'} · 共 {generatedNodePrototypes.length} 个已生成节点原型
                </div>
                <span>{incompleteCompletionTargets.length > 0 ? `仍有 ${incompleteCompletionTargets.length} 个文档包未确认` : '文档包已全部确认'}</span>
              </footer>
            </section>
          </div>
        ) : null}
      </div>
    )
  }

  if (stage === 'decomposing') {
    return (
      <div className="w-full h-screen flex bg-background animate-fade-in overflow-hidden">
        <aside className="w-[360px] shrink-0 border-r border-outline-variant bg-surface-container-low p-lg overflow-y-auto">
          <DecompProgress steps={decompositionSteps} nodeCount={nodeCount} />
        </aside>
        <main className="flex-1 overflow-hidden">
          {prdTree ? (
            <TreeCanvas
              tree={prdTree}
              selectedNodeId={selectedNodeId}
              onNodeClick={(id) => setSelectedNodeId(id)}
              onNodeDoubleClick={() => undefined}
            />
          ) : (
            <DecompLiveCanvas steps={decompositionSteps} nodeCount={nodeCount} />
          )}
        </main>
        {environmentConfigModal}
      </div>
    )
  }

  if (stage === 'preview') {
    return (
      <div className="h-screen w-full overflow-hidden bg-background p-lg blueprint-grid">
        <div className="mx-auto flex h-full max-w-[1180px] flex-col rounded-xl border border-outline-variant bg-surface-container-low/95 p-lg shadow-2xl">
          <ImportPreview
            preview={importPreview}
            isLoading={isPreviewLoading}
            error={previewError}
            projectWorkflow={projectWorkflow}
            onConfirm={handleConfirmPreview}
            onReset={handleReset}
          />
        </div>
        {environmentConfigModal}
      </div>
    )
  }

  return (
    <div className="w-full h-screen flex items-center justify-center bg-background blueprint-grid overflow-hidden">
      <div className="max-w-[480px] w-full mx-auto bg-surface-container-low border border-outline-variant rounded-xl p-12 shadow-2xl flex flex-col items-center gap-6">
        <div className="w-full transition-opacity duration-300">
          {stage === 'upload' ? (
            <UploadCard
              onImportSources={handleImportSources}
              onOpenArchive={() => { void handleOpenArchive() }}
              error={uploadError ?? projectError}
              workflowMode={projectWorkflow.mode}
              iterationCodebasePath={projectWorkflow.iteration?.codebasePath ?? ''}
              iterationFocus={projectWorkflow.iteration?.focus ?? ''}
              onWorkflowModeChange={handleWorkflowModeChange}
              onIterationCodebasePathChange={handleIterationCodebasePathChange}
              onIterationFocusChange={handleIterationFocusChange}
            />
          ) : (
            <DecompProgress steps={decompositionSteps} nodeCount={nodeCount} error={decompError} />
          )}
        </div>
      </div>
      {environmentConfigModal}
    </div>
  )
}
