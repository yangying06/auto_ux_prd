import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { getAiEnvironmentConfig, previewDecomposition, startDecomposition, pollDecomposition, exportSpecFolder, openSpecExportFolder, exportNodeMarkdown, importFigmaFrame, generatePrototype, sendNodeChatMessage } from '../lib/api'
import type { DecompositionSourcePayload } from '../lib/api'
import { MapAdjustmentPanel } from '../components/map/MapAdjustmentPanel'
import type { PrdImportPreview, PrdNode, PrdNodeOperationSuggestion, PrdNodeReference, PrdTree } from '../types/prdNode'
import type { AiEnvironmentConfig, ChatMessage } from '../types/chat'
import { useAppStore } from '../store/appStore'
import { UploadCard } from '../components/upload/UploadCard'
import { DecompProgress } from '../components/upload/DecompProgress'
import { DecompLiveCanvas } from '../components/upload/DecompLiveCanvas'
import { ImportPreview } from '../components/upload/ImportPreview'
import { PrototypePreviewSurface } from '../components/state/PrototypeSandboxPreview'
import { TopAppBar } from '../components/map/TopAppBar'
import { TreeCanvas } from '../components/map/TreeCanvas'
import { PreviewDrawer } from '../components/map/PreviewDrawer'
import { FigmaPreviewManager } from '../components/map/FigmaPreviewManager'
import { FigmaDraftBatchStatusStrip } from '../components/map/FigmaDraftBatchStatusStrip'
import { buildProjectArchiveFile, encodeProjectArchive } from '../lib/archiveCodec'
import { formatProjectArchiveError, openProjectArchiveFile, saveProjectArchiveBytes } from '../lib/archiveIO'
import { createProjectWorkspaceSnapshot } from '../lib/archiveSnapshot'
import { AddNodeModal, type AddNodePayload } from '../components/map/AddNodeModal'
import { collectDeliveryNodes, countExportableNodesByDepth, isDeliveryNode } from '../lib/prdNodeDelivery'
import { buildFigmaDraftRequirement, figmaDraftSourceKey, figmaImportToPrototypeImages, getNodeFigmaDraftSources, nodeHasGeneratedFigmaDraftSource, nodeHasPrototypeInFlight, type FigmaDraftSource } from '../lib/figmaDraftPrototype'
import { buildFigmaPrototypeIterationInstruction } from '../lib/prototypeIteration'
import { isAbortError } from '../lib/errorUtils'
import { beginPrototypeGeneration, clearPrototypeGeneration } from '../lib/prototypeGenerationRegistry'
import { EnvironmentConfigModal } from '../components/map/EnvironmentConfigModal'
import { AssetWorkbenchModal } from '../components/map/AssetWorkbenchModal'
import { buildAddedNodeContent, buildAddedNodePolishRequest, buildFlowConnectionDraftItems, buildImportSourceDocumentText, buildImportSourceFilename, buildInterfaceFlowDisplayTree, buildNodePreviewHtmlMap, buildPrototypeFlowPreview, buildSmartReference, collectPendingFigmaDraftTargets, completionGateNodes, countExportableAssetRows, countFigmaBoundDeliveryNodes, defaultArchiveFilename, defaultFlowConnectionLabel, downloadBlob, findLastActiveIdx, hasProjectData, normalizeStepPhase, shouldGenerateAddedNodeDocument, type CanvasConnectionDraft, type FlowConnectionDraft, type FlowConnectionDraftItem } from '../lib/mapPageTransforms'
import { MAP_SHORTCUT_HELP, isEditableShortcutTarget, resolveMapShortcut } from '../lib/mapKeyboardShortcuts'

type Stage = 'upload' | 'preview' | 'decomposing' | 'error' | 'map'

const INITIAL_STEP = '正在建立原文索引'
const POLL_INTERVAL_MS = 700
const EMPTY_NODE_SUGGESTIONS: PrdNodeOperationSuggestion[] = []

type SaveArchiveResult =
  | { status: 'saved'; message?: string }
  | { status: 'cancelled'; message?: string }
  | { status: 'failed'; message: string }

type ShortcutNotice = {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
}

interface MapKeyboardShortcutsProps {
  hasProject: boolean
  canExport: boolean
  canSmartArrange: boolean
  activeNode: PrdNode | null
  focusedNode: PrdNode | null
  shortcutsBlocked: boolean
  onSaveArchive: (saveAs?: boolean) => Promise<SaveArchiveResult>
  onShortcutNotice: (notice: Omit<ShortcutNotice, 'id'>) => void
  onOpenArchive: () => Promise<void>
  onNewProject: () => void
  onExport: () => Promise<void>
  onDeleteNode: (node: PrdNode) => boolean
  onAfterDeleteNode: (nodeId: string) => void
  onCloseActiveLayer: () => boolean
  onOpenDetail: (nodeId: string) => void
  onOpenForge: (node: PrdNode) => boolean
  onSmartArrange: () => void
  onAddNode: (parentId: string | null) => void
}

function MapKeyboardShortcuts({
  hasProject,
  canExport,
  canSmartArrange,
  activeNode,
  focusedNode,
  shortcutsBlocked,
  onSaveArchive,
  onShortcutNotice,
  onOpenArchive,
  onNewProject,
  onExport,
  onDeleteNode,
  onAfterDeleteNode,
  onCloseActiveLayer,
  onOpenDetail,
  onOpenForge,
  onSmartArrange,
  onAddNode,
}: MapKeyboardShortcutsProps) {
  const saveInFlightRef = useRef(false)

  useEffect(() => {
    const runSave = (saveAs: boolean) => {
      if (!hasProject) {
        onShortcutNotice({ tone: 'error', message: '保存失败' })
        return
      }
      if (saveInFlightRef.current) return
      saveInFlightRef.current = true
      void onSaveArchive(saveAs)
        .then((result) => {
          if (result.status === 'saved') {
            onShortcutNotice({ tone: 'success', message: result.message ?? '已保存' })
          } else if (result.status === 'failed') {
            onShortcutNotice({ tone: 'error', message: result.message || '保存失败' })
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : '保存失败'
          onShortcutNotice({ tone: 'error', message })
        })
        .finally(() => {
          saveInFlightRef.current = false
        })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveMapShortcut(event, isEditableShortcutTarget(event.target))
      if (!action) return

      if (action === 'save' || action === 'saveAs') {
        event.preventDefault()
        event.stopPropagation()
        runSave(action === 'saveAs')
        return
      }

      if (shortcutsBlocked && action !== 'cancelOrClose') {
        event.preventDefault()
        return
      }

      if (action === 'cancelOrClose') {
        if (!onCloseActiveLayer()) return
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (action === 'openArchive') {
        event.preventDefault()
        event.stopPropagation()
        void onOpenArchive()
        return
      }

      if (action === 'newProject') {
        event.preventDefault()
        event.stopPropagation()
        onNewProject()
        return
      }

      if (action === 'exportSpec') {
        event.preventDefault()
        if (canExport) {
          event.stopPropagation()
          void onExport()
        }
        return
      }

      if (action === 'smartArrange') {
        event.preventDefault()
        if (canSmartArrange) {
          event.stopPropagation()
          onSmartArrange()
        }
        return
      }

      if (action === 'deleteNode') {
        const node = activeNode
        if (!node) return
        event.preventDefault()
        event.stopPropagation()
        if (onDeleteNode(node)) onAfterDeleteNode(node.id)
        return
      }

      if (action === 'openDetail') {
        const node = focusedNode ?? activeNode
        if (!node) return
        event.preventDefault()
        event.stopPropagation()
        onOpenDetail(node.id)
        return
      }

      if (action === 'openForge') {
        const node = focusedNode ?? activeNode
        if (!node) return
        event.preventDefault()
        if (onOpenForge(node)) event.stopPropagation()
        return
      }

      if (action === 'addNode') {
        event.preventDefault()
        event.stopPropagation()
        onAddNode((focusedNode ?? activeNode)?.id ?? null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeNode,
    canExport,
    canSmartArrange,
    focusedNode,
    hasProject,
    onAddNode,
    onAfterDeleteNode,
    onCloseActiveLayer,
    onDeleteNode,
    onExport,
    onNewProject,
    onOpenArchive,
    onOpenDetail,
    onOpenForge,
    onSaveArchive,
    onShortcutNotice,
    onSmartArrange,
    shortcutsBlocked,
  ])

  return null
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
  const [shortcutPanelOpen, setShortcutPanelOpen] = useState(false)
  const [shortcutNotice, setShortcutNotice] = useState<ShortcutNotice | null>(null)
  const [environmentStatus, setEnvironmentStatus] = useState<AiEnvironmentConfig | null>(null)
  const [flowConnectionDraft, setFlowConnectionDraft] = useState<FlowConnectionDraft | null>(null)
  const [canvasConnectionDraft, setCanvasConnectionDraft] = useState<CanvasConnectionDraft | null>(null)
  const [canvasFocusNodeId, setCanvasFocusNodeId] = useState<string | null>(null)
  const [statePreviewNodeId, setStatePreviewNodeId] = useState<string | null>(null)
  const [smartArrangeFitRequest, setSmartArrangeFitRequest] = useState(0)
  const sessionIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInFlightRef = useRef(false)
  const previewRequestRef = useRef(0)

  const [, navigate] = useLocation()

  const prdTree = useAppStore((s) => s.prdTree)
  const settings = useAppStore((s) => s.settings)
  const sourceDocument = useAppStore((s) => s.sourceDocument)
  const currentArchivePath = useAppStore((s) => s.currentArchivePath)
  const archiveDirty = useAppStore((s) => s.archiveDirty)
  const nodePrototypeStates = useAppStore((s) => s.nodePrototypeStates)
  const appendNodeMessage = useAppStore((s) => s.appendNodeMessage)
  const setNodePrototypeVariants = useAppStore((s) => s.setNodePrototypeVariants)
  const selectNodePrototypeVariant = useAppStore((s) => s.selectNodePrototypeVariant)
  const markNodeFigmaDraftSourceGenerated = useAppStore((s) => s.markNodeFigmaDraftSourceGenerated)
  const assetWorkbench = useAppStore((s) => s.assetWorkbench)
  const qaIssues = useAppStore((s) => s.qaIssues)
  const figmaDraftBatch = useAppStore((s) => s.figmaDraftBatch)
  const setFigmaDraftBatch = useAppStore((s) => s.setFigmaDraftBatch)
  const decompositionSteps = useAppStore((s) => s.decompositionSteps)
  const setDecompositionStatus = useAppStore((s) => s.setDecompositionStatus)
  const appendDecompositionStep = useAppStore((s) => s.appendDecompositionStep)
  const updateDecompositionStep = useAppStore((s) => s.updateDecompositionStep)
  const resetDecomposition = useAppStore((s) => s.resetDecomposition)
  const setPrdTree = useAppStore((s) => s.setPrdTree)
  const setSourceDocument = useAppStore((s) => s.setSourceDocument)
  const loadArchiveSnapshot = useAppStore((s) => s.loadArchiveSnapshot)
  const markArchiveSaved = useAppStore((s) => s.markArchiveSaved)
  const resetProject = useAppStore((s) => s.resetProject)
  const createPageNode = useAppStore((s) => s.createPageNode)
  const updateNode = useAppStore((s) => s.updateNode)
  const updateNodeContent = useAppStore((s) => s.updateNodeContent)
  const applyNodePolish = useAppStore((s) => s.applyNodePolish)
  const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)
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
  const clearCanvasNodePositions = useAppStore((s) => s.clearCanvasNodePositions)
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

  const showShortcutNotice = (notice: Omit<ShortcutNotice, 'id'>) => {
    setShortcutNotice({ ...notice, id: Date.now() })
  }

  const generateFigmaDraftForNode = async (node: PrdNode, tree: PrdTree, sourceInput?: FigmaDraftSource, batchLabel?: string) => {
    const source = sourceInput ?? getNodeFigmaDraftSources(node)[0]
    if (!source) throw new Error(`Node ${node.id} has no Figma source.`)
    const sourceKey = figmaDraftSourceKey(source)
    const abortController = beginPrototypeGeneration(node.id)
    if (!abortController) throw new Error(`Node ${node.id} already has prototype generation in progress.`)

    const currentPrototypeState = useAppStore.getState().nodePrototypeStates[node.id]
    const selectedVariant = currentPrototypeState?.prototypeVariants.find((variant) => variant.index === currentPrototypeState.selectedVariantIndex)
    const currentHtml = selectedVariant?.html ?? currentPrototypeState?.prototypeHtml ?? null
    const baseVariantIndex = selectedVariant?.index ?? (currentPrototypeState?.selectedVariantIndex ?? 0)
    const normalizedBaseVariantIndex = baseVariantIndex >= 0 ? baseVariantIndex : 0
    const prototypeSnapshotBeforeGeneration = {
      prototypeVariants: currentPrototypeState?.prototypeVariants ?? [],
      selectedVariantIndex: currentPrototypeState?.selectedVariantIndex ?? -1,
    }

    const restorePrototypeAfterCancel = () => {
      setNodePrototypeVariants(node.id, prototypeSnapshotBeforeGeneration.prototypeVariants)
      if (prototypeSnapshotBeforeGeneration.selectedVariantIndex >= 0) {
        selectNodePrototypeVariant(node.id, prototypeSnapshotBeforeGeneration.selectedVariantIndex)
      }
    }

    setNodePrototypeVariants(node.id, [{
      index: currentHtml ? normalizedBaseVariantIndex : 0,
      html: currentHtml,
      status: 'streaming' as const,
      focus: `Figma first draft: ${source.label}`,
      history: selectedVariant?.history,
      assetAudit: selectedVariant?.assetAudit,
      prototypeSpec: selectedVariant?.prototypeSpec ?? null,
    }])
    appendNodeMessage(node.id, {
      role: 'assistant',
      content: `${batchLabel ? `${batchLabel}\n` : ''}Generating a first draft prototype from bound Figma source: ${source.label}`,
    })

    try {
      const result = await importFigmaFrame(settings.proxyBaseUrl, { url: source.url })
      if (abortController.signal.aborted) throw new DOMException('Prototype generation cancelled.', 'AbortError')
      const latestState = useAppStore.getState().nodePrototypeStates[node.id]
      const latestSelectedVariant = latestState?.prototypeVariants.find((variant) => variant.index === latestState.selectedVariantIndex)
      const latestHtml = latestSelectedVariant?.html ?? latestState?.prototypeHtml ?? currentHtml ?? null
      const hasExistingPrototype = Boolean(latestHtml?.trim())
      const requirementState = buildFigmaDraftRequirement(node, tree, result, source)
      const instruction = buildFigmaPrototypeIterationInstruction(result, hasExistingPrototype)
      const variantIndex = latestSelectedVariant?.index ?? (latestState?.selectedVariantIndex ?? normalizedBaseVariantIndex)
      const response = await generatePrototype(settings.proxyBaseUrl, requirementState, {
        currentHtml: latestHtml,
        instruction,
        images: figmaImportToPrototypeImages(result),
        numVariants: 1,
        variantIndex: hasExistingPrototype ? Math.max(0, variantIndex) : undefined,
        history: latestSelectedVariant?.history ?? selectedVariant?.history,
        signal: abortController.signal,
      })

      setNodePrototypeVariants(node.id, response.variants.map((variant) => ({
        index: variant.index,
        html: variant.html,
        status: variant.status,
        focus: variant.focus,
        history: variant.history,
        error: variant.error,
        assetAudit: variant.assetAudit,
      })))
      const chosen = response.variants.find((variant) => variant.status === 'complete' && variant.html)
      if (!chosen?.html) {
        const message = response.variants.find((variant) => variant.error)?.error ?? 'No complete HTML prototype was returned.'
        throw new Error(message)
      }
      selectNodePrototypeVariant(node.id, chosen.index)
      markNodeFigmaDraftSourceGenerated(node.id, sourceKey)
      appendNodeMessage(node.id, {
        role: 'assistant',
        content: `First draft prototype generated from Figma: ${result.panelName}`,
      })
    } catch (err) {
      if (abortController.signal.aborted || isAbortError(err)) {
        restorePrototypeAfterCancel()
        appendNodeMessage(node.id, {
          role: 'assistant',
          content: 'Figma first draft generation cancelled by user.',
        })
        throw err
      }
      const message = err instanceof Error ? err.message : 'Figma draft generation failed.'
      setNodePrototypeVariants(node.id, [{
        index: 0,
        html: null,
        status: 'error' as const,
        focus: 'Figma first draft',
        error: message,
      }])
      appendNodeMessage(node.id, {
        role: 'assistant',
        content: `Figma first draft generation failed: ${message}`,
      })
      throw err
    } finally {
      clearPrototypeGeneration(node.id, abortController)
    }
  }

  const confirmProjectClose = (actionLabel: string) => {
    if (!archiveDirty || !hasProjectData(prdTree, sourceDocument)) return true
    return window.confirm(`当前项目有未保存修改。确定要${actionLabel}吗？`)
  }

  const handleSaveArchive = async (saveAs = false) => {
    if (!hasProjectData(prdTree, sourceDocument)) {
      const message = '保存失败'
      setProjectError('当前没有可保存的项目。')
      return { status: 'failed', message } satisfies SaveArchiveResult
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
        return { status: 'saved', message: '已保存' } satisfies SaveArchiveResult
      }
      return { status: 'cancelled', message: '已取消保存' } satisfies SaveArchiveResult
    } catch (err) {
      const message = formatProjectArchiveError(err, '保存失败')
      setProjectError(message)
      return { status: 'failed', message } satisfies SaveArchiveResult
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
      files: sources.sourceFiles ?? [],
    })
    setPendingImportSources(sources)
    setImportPreview(null)
    setPreviewError(null)
    setIsPreviewLoading(true)
    setStage('preview')
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId

    try {
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
      })
      .catch(() => {
        if (!cancelled) setEnvironmentStatus(null)
      })
    return () => { cancelled = true }
  }, [settings.proxyBaseUrl])

  useEffect(() => {
    if (!environmentConfigOpen) return
    let cancelled = false
    getAiEnvironmentConfig(settings.proxyBaseUrl)
      .then((status) => {
        if (!cancelled) setEnvironmentStatus(status)
      })
      .catch(() => {
        if (!cancelled) setEnvironmentStatus(null)
      })
    return () => { cancelled = true }
  }, [environmentConfigOpen, settings.proxyBaseUrl])

  const environmentConfigModal = (
    <EnvironmentConfigModal
      open={environmentConfigOpen}
      required={false}
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
    if (!shortcutNotice) return
    const timeout = window.setTimeout(() => {
      setShortcutNotice((current) => (current?.id === shortcutNotice.id ? null : current))
    }, 2600)
    return () => window.clearTimeout(timeout)
  }, [shortcutNotice])

  useEffect(() => {
    if (!canvasFocusNodeId) return
    if (prdTree?.[canvasFocusNodeId]) return
    setCanvasFocusNodeId(null)
  }, [canvasFocusNodeId, prdTree])

  if (stage === 'map' && prdTree) {
    const nodePreviewHtmlMap = buildNodePreviewHtmlMap(nodePrototypeStates)
    const figmaBoundNodeCount = countFigmaBoundDeliveryNodes(prdTree)
    const pendingFigmaDraftTargets = collectPendingFigmaDraftTargets(prdTree, nodePrototypeStates)
    const displayTree = buildInterfaceFlowDisplayTree(prdTree)
    const selectedNode = selectedNodeId && displayTree[selectedNodeId] ? (prdTree[selectedNodeId] ?? null) : null
    const focusedNode = canvasFocusNodeId && displayTree[canvasFocusNodeId] ? (prdTree[canvasFocusNodeId] ?? null) : null
    const activeShortcutNode = selectedNode ?? focusedNode
    const statePreviewNode = statePreviewNodeId ? prdTree[statePreviewNodeId] ?? null : null

    const completionTargets = completionGateNodes(prdTree)
    const incompleteCompletionTargets = completionTargets.filter((node) => node.status !== 'done')
    const prototypeFlowPreview = buildPrototypeFlowPreview(prdTree, nodePrototypeStates)
    const generatedNodePrototypes = prototypeFlowPreview.nodes
    const prototypeFlowSteps = prototypeFlowPreview.steps
    const prototypeFlowStepByNodeId = new Map(prototypeFlowSteps.map((step) => [step.node.id, step]))
    const selectedNodePrototype = (
      selectedPrototypeNodeId ? prototypeFlowStepByNodeId.get(selectedPrototypeNodeId) : null
    ) ?? prototypeFlowSteps[0]
    const previousPrototypeStep = selectedNodePrototype?.previousNodeId
      ? prototypeFlowStepByNodeId.get(selectedNodePrototype.previousNodeId) ?? null
      : null
    const nextPrototypeStep = selectedNodePrototype?.nextNodeId
      ? prototypeFlowStepByNodeId.get(selectedNodePrototype.nextNodeId) ?? null
      : null
    const exportableCount = countExportableNodesByDepth(prdTree, 'all')
    const canExport = exportableCount > 0
    const canValidatePrototype = completionTargets.length > 0
    const hasProject = hasProjectData(prdTree, sourceDocument)
    const topError = exportError ?? projectError
    const canSmartArrange = Object.keys(displayTree).length > 1
    const qaOpenIssueCount = Object.values(qaIssues).filter((issue) => issue.status !== 'draft' && issue.status !== 'closed').length
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
      updateNode(sourceNode.id, {
        references: [
          ...(sourceNode.references ?? []),
          smartReference,
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
      const items = buildFlowConnectionDraftItems(sourceNode, targetNode)
      const hasExistingItems = items.some((item) => item.originalIndex !== null)

      setFlowConnectionDraft({
        isOpen: true,
        mode: direction,
        sourceNodeId,
        targetNodeId,
        originalSourceNodeId: hasExistingItems ? sourceNodeId : null,
        originalTargetNodeId: hasExistingItems ? targetNodeId : null,
        items,
      })
    }

    const openExistingReferenceDraft = (sourceNodeId: string, targetNodeId: string) => {
      const sourceNode = prdTree[sourceNodeId]
      const targetNode = prdTree[targetNodeId]
      if (!sourceNode || !targetNode) return

      setFlowConnectionDraft({
        isOpen: true,
        mode: 'edge',
        sourceNodeId,
        targetNodeId,
        originalSourceNodeId: sourceNodeId,
        originalTargetNodeId: targetNodeId,
        items: buildFlowConnectionDraftItems(sourceNode, targetNode),
      })
    }

    const closeFlowConnectionDraft = () => {
      setFlowConnectionDraft(null)
    }

    const updateFlowConnectionDraftItem = (itemIndex: number, patch: Partial<Pick<FlowConnectionDraftItem, 'label' | 'reason'>>) => {
      if (!flowConnectionDraft) return
      setFlowConnectionDraft({
        ...flowConnectionDraft,
        items: flowConnectionDraft.items.map((item, index) => (
          index === itemIndex ? { ...item, ...patch } : item
        )),
      })
    }

    const deleteFlowConnectionDraftItem = (itemIndex: number) => {
      if (!flowConnectionDraft || flowConnectionDraft.items.length <= 1) return
      setFlowConnectionDraft({
        ...flowConnectionDraft,
        items: flowConnectionDraft.items.filter((_, index) => index !== itemIndex),
      })
    }

    const saveFlowConnectionDraft = () => {
      if (!flowConnectionDraft) return
      const sourceNode = prdTree[flowConnectionDraft.sourceNodeId]
      const targetNode = prdTree[flowConnectionDraft.targetNodeId]
      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return

      const fallbackLabel = defaultFlowConnectionLabel(sourceNode, targetNode)
      const draftItems = flowConnectionDraft.items.length
        ? flowConnectionDraft.items
        : [{ originalIndex: null, label: fallbackLabel, reason: '' }]
      const nextReferences: PrdNodeReference[] = draftItems.map((item) => ({
        targetNodeId: targetNode.id,
        label: item.label.trim() || fallbackLabel,
        reason: item.reason.trim() || null,
        sourceNodeId: sourceNode.id,
      }))

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
      updateNode(sourceNode.id, { references: [...references, ...nextReferences] })
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
          depth: 'all',
          includeAssets,
          assetWorkbench,
          prototypeHtmlExports: generatedNodePrototypes.map(({ node, html }) => ({
            nodeId: node.id,
            label: node.label,
            html,
          })),
        })
        for (const doc of result.documents) {
          setNodeDocPath(doc.nodeId, doc.docPath)
        }
        const assetSummary = includeAssets && result.assets
          ? `\n素材清单：${result.assets.manifestPath}\n已复制文件：${result.assets.copiedFiles} 个，跳过：${result.assets.skippedItems} 项`
          : ''
        const evidenceSummary = result.evidence
          ? `\n证据链索引：${result.evidence.manifestPath}\n证据文件：${result.evidence.documents.length} 个`
          : ''
        const prototypeSummary = result.prototypes
          ? `\nHTML 原型索引：${result.prototypes.manifestPath}\nHTML 原型文件：${result.prototypes.documents.length} 个`
          : ''
        alert(`已导出完整页面级 spec 文档包：${result.exportDir}\n共 ${result.documents.length} 篇文档（包含尚未打磨的草稿，仅供早期评审）${evidenceSummary}${prototypeSummary}${assetSummary}`)
        try {
          await openSpecExportFolder(settings.proxyBaseUrl)
        } catch (openError) {
          setExportError(openError instanceof Error ? openError.message : '打开导出文件夹失败')
        }
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
      const shouldGenerateDocument = shouldGenerateAddedNodeDocument(supplementText, sources, sourceDocument)
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

        if (!shouldGenerateDocument) {
          handleCloseAddNode()
          return
        }

        setAddNodeAssistantReply('已创建节点，正在根据 PRD 生成界面子文档...')
        const nextTree = useAppStore.getState().prdTree ?? {}
        const parentLabel = parentId ? nextTree[parentId]?.label ?? null : null
        const userMessage: ChatMessage = {
          role: 'user',
          content: buildAddedNodePolishRequest({
            title: payload.title,
            parentLabel,
            supplementText,
            sources,
            hasProjectPrd: Boolean(sourceDocument?.text?.trim()),
          }),
        }
        appendNodeMessage(newNodeId, userMessage)
        const response = await sendNodeChatMessage(settings.proxyBaseUrl, newNodeId, userMessage, nextTree, {
          sourceDocument,
          contextMessages: [userMessage],
        })
        if (response.nodePatch) {
          applyNodePolish(newNodeId, response.nodePatch)
        }
        if (response.nodeComplete) {
          updateNodeStatus(newNodeId, 'done')
        }
        const assistantReply = response.reply || (response.nodePatch ? '已根据 PRD 生成新增界面子文档。' : '已创建节点，但 AI 没有返回可写入的子文档。')
        appendNodeMessage(newNodeId, { role: 'assistant', content: assistantReply })
        setAddNodeAssistantReply(assistantReply)
        if (!response.nodePatch) {
          setAddNodeError('新增节点已创建，但 AI 没有返回可写入的子文档；可以打开 Deep Forge 继续补齐。')
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
        return true
      }
      return false
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

      setSelectedPrototypeNodeId(prototypeFlowPreview.entryNodeId ?? generatedNodePrototypes[0]?.node.id ?? null)
      setIsPrototypeModalOpen(true)
    }

    const handleOpenQaForNode = (node: PrdNode) => {
      createQaIssue(isDeliveryNode(node, prdTree) ? node.id : null)
      navigate('/qa')
    }

    const handleOpenQaFromToolbar = () => {
      navigate('/qa')
    }

    const handleSmartArrange = () => {
      clearCanvasNodePositions()
      setCanvasConnectionDraft(null)
      setSmartArrangeFitRequest((value) => value + 1)
    }

    const handleOpenForgeShortcut = (node: PrdNode) => {
      if (!isDeliveryNode(node, prdTree) || (!node.needsPolish && node.status !== 'done')) return false
      navigate('/forge/' + node.id)
      return true
    }

    const shortcutsBlocked = Boolean(
      canvasConnectionDraft
      || flowConnectionDraft?.isOpen
      || isAddNodeModalOpen
      || environmentConfigOpen
      || assetWorkbenchOpen
      || shortcutPanelOpen
      || isPrototypeModalOpen
      || statePreviewNodeId,
    )

    const handleCloseActiveShortcutLayer = () => {
      if (flowConnectionDraft?.isOpen) {
        closeFlowConnectionDraft()
        return true
      }
      if (canvasConnectionDraft) {
        cancelCanvasConnection()
        return true
      }
      if (statePreviewNodeId) {
        setStatePreviewNodeId(null)
        return true
      }
      if (isAddNodeModalOpen) {
        handleCloseAddNode()
        return true
      }
      if (isPrototypeModalOpen) {
        setIsPrototypeModalOpen(false)
        return true
      }
      if (assetWorkbenchOpen) {
        setAssetWorkbenchOpen(false)
        return true
      }
      if (environmentConfigOpen) {
        setEnvironmentConfigOpen(false)
        return true
      }
      if (shortcutPanelOpen) {
        setShortcutPanelOpen(false)
        return true
      }
      if (selectedNodeId) {
        setSelectedNodeId(null)
        return true
      }
      if (canvasFocusNodeId) {
        setCanvasFocusNodeId(null)
        return true
      }
      return false
    }

    const handleAfterShortcutDelete = (nodeId: string) => {
      if (canvasFocusNodeId === nodeId) setCanvasFocusNodeId(null)
      if (selectedNodeId === nodeId) setSelectedNodeId(null)
      if (statePreviewNodeId === nodeId) setStatePreviewNodeId(null)
      if (canvasConnectionDraft?.nodeId === nodeId) setCanvasConnectionDraft(null)
      if (selectedPrototypeNodeId === nodeId) setSelectedPrototypeNodeId(null)
    }

    const handleOpenShortcutDetail = (nodeId: string) => {
      if (!prdTree[nodeId]) return
      setCanvasFocusNodeId(nodeId)
      setSelectedNodeId(nodeId)
    }

    const shortcutGroups = [
      { id: 'project', label: '项目', items: MAP_SHORTCUT_HELP.filter((item) => item.group === 'project') },
      { id: 'canvas', label: '画布', items: MAP_SHORTCUT_HELP.filter((item) => item.group === 'canvas') },
      { id: 'node', label: '节点', items: MAP_SHORTCUT_HELP.filter((item) => item.group === 'node') },
    ]
    const shortcutNoticeClass = shortcutNotice?.tone === 'error'
      ? 'border-error/40 bg-error-container text-on-error-container'
      : shortcutNotice?.tone === 'success'
        ? 'border-tertiary/50 bg-tertiary-container text-tertiary'
        : 'border-primary/40 bg-primary-container text-on-primary-container'
    const shortcutNoticeIcon = shortcutNotice?.tone === 'error'
      ? 'error'
      : shortcutNotice?.tone === 'success'
        ? 'check_circle'
        : 'info'

    const handleBatchGenerateFigmaDrafts = async () => {
      const latest = useAppStore.getState()
      const latestTree = latest.prdTree ?? prdTree
      const targets = collectPendingFigmaDraftTargets(latestTree, latest.nodePrototypeStates)
      if (!targets.length || figmaDraftBatch.isRunning) return

      let latestEnvironmentStatus: AiEnvironmentConfig | null = environmentStatus
      try {
        latestEnvironmentStatus = await getAiEnvironmentConfig(settings.proxyBaseUrl)
        setEnvironmentStatus(latestEnvironmentStatus)
      } catch (err) {
        const message = err instanceof Error ? err.message : '无法读取本地环境配置。'
        setProjectError(`Figma 首稿批量生成前置检查失败：${message}`)
        return
      }
      if (!latestEnvironmentStatus?.values.FIGMA_TOKEN_PRESENT) {
        setProjectError('Figma 首稿批量生成需要先配置 FIGMA_TOKEN。请在环境配置中粘贴可访问该设计稿的 Figma Personal Access Token。')
        setEnvironmentConfigOpen(true)
        return
      }
      if (!latestEnvironmentStatus.values.ANTHROPIC_API_KEY_PRESENT) {
        setProjectError('Figma 首稿批量生成需要先配置 ANTHROPIC_API_KEY，用于调用 AI 原型生成。')
        setEnvironmentConfigOpen(true)
        return
      }

      const confirmed = window.confirm(
        `Will generate or update draft prototypes from ${targets.length} pending Figma source(s). Already completed sources will be skipped. Continue?`,
      )
      if (!confirmed) return

      setFigmaDraftBatch({ isRunning: true, status: `Preparing ${targets.length} Figma draft source(s)...` })
      setProjectError(null)
      let generated = 0
      let failed = 0
      let cancelled = false
      const failureSummaries = new Map<string, { count: number; labels: string[] }>()

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]
        const current = useAppStore.getState()
        const currentTree = current.prdTree ?? latestTree
        const currentNode = currentTree[target.node.id]
        if (!currentNode) continue
        const currentState = current.nodePrototypeStates[currentNode.id]
        const targetSourceKey = figmaDraftSourceKey(target.source)
        const currentSource = getNodeFigmaDraftSources(currentNode).find((source) => figmaDraftSourceKey(source) === targetSourceKey) ?? target.source
        if (!currentSource || nodeHasPrototypeInFlight(currentState) || nodeHasGeneratedFigmaDraftSource(currentState, currentSource)) continue

        setFigmaDraftBatch({ status: `Generating ${index + 1}/${targets.length}: ${currentNode.label} - ${currentSource.label}` })
        try {
          await generateFigmaDraftForNode(currentNode, currentTree, currentSource, `Batch Figma draft ${index + 1}/${targets.length}`)
          generated += 1
        } catch (err) {
          if (isAbortError(err)) {
            cancelled = true
            break
          }
          failed += 1
          const message = err instanceof Error ? err.message : 'Figma draft generation failed.'
          const normalizedMessage = message.replace(/\s+/g, ' ').trim() || 'Figma draft generation failed.'
          const summary = failureSummaries.get(normalizedMessage) ?? { count: 0, labels: [] }
          summary.count += 1
          if (summary.labels.length < 3) summary.labels.push(currentNode.label)
          failureSummaries.set(normalizedMessage, summary)
        }
      }

      setFigmaDraftBatch({
        isRunning: false,
        status: cancelled
          ? `Figma draft batch cancelled: ${generated} generated, ${failed} failed.`
          : `Figma draft batch complete: ${generated} generated, ${failed} failed.`,
      })
      if (cancelled) return
      if (failed > 0) {
        const [primaryMessage, primarySummary] = [...failureSummaries.entries()]
          .sort((a, b) => b[1].count - a[1].count)[0] ?? []
        const clippedMessage = primaryMessage && primaryMessage.length > 240
          ? `${primaryMessage.slice(0, 240)}...`
          : primaryMessage
        const affectedText = primarySummary?.labels.length
          ? ` 影响节点示例：${primarySummary.labels.join('、')}。`
          : ''
        const reasonText = clippedMessage
          ? `主要原因（${primarySummary?.count ?? failed}/${failed}）：${clippedMessage}。${affectedText}`
          : '请查看节点对话中的完整错误。'
        setProjectError(`Figma 首稿批量生成完成：${generated} 个成功，${failed} 个失败。${reasonText}`)
      }
    }

    return (
      <div className="w-full h-screen flex flex-col bg-background animate-fade-in overflow-hidden">
        <MapKeyboardShortcuts
          hasProject={hasProject}
          canExport={canExport}
          canSmartArrange={canSmartArrange}
          activeNode={activeShortcutNode}
          focusedNode={focusedNode}
          shortcutsBlocked={shortcutsBlocked}
          onSaveArchive={handleSaveArchive}
          onShortcutNotice={showShortcutNotice}
          onOpenArchive={handleOpenArchive}
          onNewProject={handleNewProject}
          onExport={handleExport}
          onDeleteNode={handleDeleteNode}
          onAfterDeleteNode={handleAfterShortcutDelete}
          onCloseActiveLayer={handleCloseActiveShortcutLayer}
          onOpenDetail={handleOpenShortcutDetail}
          onOpenForge={handleOpenForgeShortcut}
          onSmartArrange={handleSmartArrange}
          onAddNode={handleOpenAddNode}
        />
        <TopAppBar
          projectName={settings.projectName}
          archiveDirty={archiveDirty}
          currentArchivePath={currentArchivePath}
          hasProject={hasProject}
          onNewProject={handleNewProject}
          onOpenArchive={() => { void handleOpenArchive() }}
          onSaveArchive={() => { void handleSaveArchive(false) }}
          onSaveArchiveAs={() => { void handleSaveArchive(true) }}
          onOpenShortcuts={() => setShortcutPanelOpen(true)}
          onConfigureEnvironment={() => setEnvironmentConfigOpen(true)}
          onDeleteProject={handleDeleteProject}
          exportableCount={exportableCount}
          canExport={canExport}
          onExport={handleExport}
          isExporting={isExporting}
          onValidatePrototype={() => { void handleOpenProjectPrototype() }}
          canValidatePrototype={canValidatePrototype}
          prototypeValidationRiskCount={incompleteCompletionTargets.length}
          onSmartArrange={handleSmartArrange}
          canSmartArrange={canSmartArrange}
          onBatchGenerateFigmaDrafts={() => { void handleBatchGenerateFigmaDrafts() }}
          canBatchGenerateFigmaDrafts={pendingFigmaDraftTargets.length > 0 && !figmaDraftBatch.isRunning}
          isBatchGeneratingFigmaDrafts={figmaDraftBatch.isRunning}
          figmaDraftReadyCount={pendingFigmaDraftTargets.length}
          figmaDraftTotalCount={figmaBoundNodeCount}
          onOpenAssets={() => setAssetWorkbenchOpen(true)}
          onOpenQa={handleOpenQaFromToolbar}
          qaOpenIssueCount={qaOpenIssueCount}
        />
        <FigmaDraftBatchStatusStrip status={figmaDraftBatch.status} isRunning={figmaDraftBatch.isRunning} />
        {shortcutNotice ? (
          <div
            role="status"
            className={`fixed right-lg top-[72px] z-[180] flex max-w-[360px] items-center gap-sm rounded-lg border px-md py-sm text-label-md shadow-2xl backdrop-blur ${shortcutNoticeClass}`}
          >
            <span className="material-symbols-outlined shrink-0" style={{ fontSize: '18px' }}>{shortcutNoticeIcon}</span>
            <span className="min-w-0">{shortcutNotice.message}</span>
            <button
              type="button"
              onClick={() => setShortcutNotice(null)}
              className="ml-xs rounded p-[2px] opacity-70 transition-opacity hover:opacity-100"
              aria-label="关闭提示"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
            </button>
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
        {shortcutPanelOpen ? (
          <div
            className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-lg backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-panel-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShortcutPanelOpen(false)
            }}
          >
            <section className="flex max-h-[86vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-2xl">
              <header className="flex shrink-0 items-center justify-between gap-md border-b border-outline-variant bg-surface-container-low px-lg py-md">
                <div className="min-w-0">
                  <div className="flex items-center gap-sm">
                    <span className="material-symbols-outlined text-primary" style={{ fontSize: '20px' }}>keyboard</span>
                    <h2 id="shortcut-panel-title" className="font-title-md text-title-md text-on-surface">快捷键</h2>
                  </div>
                  <p className="mt-xs text-body-sm text-on-surface-variant">当前导图工作区可用快捷键</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShortcutPanelOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:text-on-surface"
                  aria-label="关闭快捷键面板"
                  title="关闭"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                </button>
              </header>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-lg py-md">
                <div className="grid gap-lg md:grid-cols-3">
                  {shortcutGroups.map((group) => (
                    <section key={group.id} className="min-w-0">
                      <h3 className="mb-sm flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
                        <span className="h-px flex-1 bg-outline-variant/70" />
                        <span>{group.label}</span>
                        <span className="h-px flex-1 bg-outline-variant/70" />
                      </h3>
                      <div className="space-y-xs">
                        {group.items.map((item) => (
                          <div
                            key={item.action}
                            className="rounded-md border border-outline-variant bg-surface-container-low px-sm py-sm"
                          >
                            <div className="flex flex-wrap items-center gap-xs">
                              {item.keys.map((key) => (
                                <kbd
                                  key={key}
                                  className="rounded border border-outline-variant bg-surface px-xs py-[2px] font-mono text-[11px] leading-4 text-on-surface"
                                >
                                  {key}
                                </kbd>
                              ))}
                            </div>
                            <div className="mt-xs font-label-md text-label-md text-on-surface">{item.label}</div>
                            <p className="mt-[2px] text-body-sm leading-snug text-on-surface-variant">{item.description}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </section>
          </div>
        ) : null}
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
              fitRequest={smartArrangeFitRequest}
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
              onOpenForge={(id) => navigate('/forge/' + id)}
              onCanvasBlankClick={() => {
                if (selectedNodeId) setSelectedNodeId(null)
              }}
              onOpenStatePreview={(id) => {
                setCanvasFocusNodeId(id)
                setStatePreviewNodeId(id)
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
            onUpdateNode={updateNode}
            onUpdateContent={updateNodeContent}
            onOpenQa={handleOpenQaForNode}
            proxyBaseUrl={settings.proxyBaseUrl}
          />
        </main>
        {statePreviewNode ? (
          <FigmaPreviewManager
            node={statePreviewNode}
            tree={prdTree}
            proxyBaseUrl={settings.proxyBaseUrl}
            onClose={() => setStatePreviewNodeId(null)}
            onUpdateNode={updateNode}
          />
        ) : null}
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
                        items: sourceNode && targetNode
                          ? buildFlowConnectionDraftItems(sourceNode, targetNode)
                          : flowConnectionDraft.items,
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
                        items: sourceNode && targetNode
                          ? buildFlowConnectionDraftItems(sourceNode, targetNode)
                          : flowConnectionDraft.items,
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
                <div className="flex items-center justify-between gap-sm">
                  <span className="font-label-md text-label-md text-on-surface-variant">条件标题</span>
                  {flowConnectionDraft.items.length > 1 ? (
                    <span className="rounded border border-secondary/40 bg-secondary-container/20 px-xs py-[2px] text-code-sm text-secondary">
                      {flowConnectionDraft.items.length} 条
                    </span>
                  ) : null}
                </div>

                <div className="space-y-sm">
                  {flowConnectionDraft.items.map((item, itemIndex) => (
                    <div
                      key={`${item.originalIndex ?? 'new'}-${itemIndex}`}
                      className="space-y-sm rounded-lg border border-outline-variant bg-surface-container-low p-sm"
                    >
                      <div className="flex items-center justify-between gap-sm">
                        <span className="font-label-md text-label-md text-on-surface">条件 {itemIndex + 1}</span>
                        {flowConnectionDraft.items.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => deleteFlowConnectionDraftItem(itemIndex)}
                            className="inline-flex h-8 items-center gap-xs rounded border border-error/40 px-sm text-label-md text-error transition-colors hover:bg-error/10"
                            title="删除这个条件标题"
                            aria-label={`删除条件 ${itemIndex + 1}`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                            删除
                          </button>
                        ) : null}
                      </div>

                      <label className="flex min-w-0 flex-col gap-xs">
                        <span className="font-label-md text-label-md text-on-surface-variant">线条标题</span>
                        <input
                          value={item.label}
                          onChange={(event) => updateFlowConnectionDraftItem(itemIndex, { label: event.target.value })}
                          placeholder="例如：点击列表按钮打开帮助界面"
                          className="h-10 rounded border border-outline-variant bg-surface px-sm text-body-sm text-on-surface outline-none focus:border-primary"
                        />
                      </label>

                      <label className="flex min-w-0 flex-col gap-xs">
                        <span className="font-label-md text-label-md text-on-surface-variant">详情</span>
                        <textarea
                          value={item.reason}
                          onChange={(event) => updateFlowConnectionDraftItem(itemIndex, { reason: event.target.value })}
                          placeholder="说明：从哪个界面的哪个状态，通过点击什么按钮或满足什么条件，跳转到哪个界面的哪个状态。例如：主界面默认态点击“列表”按钮，打开列表浮层后点击“帮助”，进入帮助界面的默认态。"
                          className="min-h-[104px] rounded border border-outline-variant bg-surface p-sm text-body-sm leading-relaxed text-on-surface outline-none focus:border-primary"
                        />
                      </label>
                    </div>
                  ))}
                </div>

                {flowConnectionDraft.sourceNodeId === flowConnectionDraft.targetNodeId ? (
                  <div className="rounded border border-error/40 bg-error/10 px-sm py-xs text-body-sm text-error">
                    源界面和目标界面不能相同。
                  </div>
                ) : null}
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant bg-surface-container-low px-lg py-md">
                <div>
                  {flowConnectionDraft.originalSourceNodeId
                    && flowConnectionDraft.originalTargetNodeId
                    && flowConnectionDraft.items.length === 1 ? (
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
              <div className="flex shrink-0 flex-col gap-sm border-b border-outline-variant bg-surface-container-low px-md py-sm md:px-lg">
                <div className="flex min-w-0 items-center gap-sm">
                  <div className="flex min-w-0 flex-1 gap-xs overflow-x-auto" data-prototype-flow-steps="true">
                    {prototypeFlowSteps.map((step) => (
                      <button
                        key={step.node.id}
                        type="button"
                        data-prototype-flow-step={step.node.id}
                        onClick={() => setSelectedPrototypeNodeId(step.node.id)}
                        title={step.nextEdge ? `${step.node.label}\n下一步：${step.nextEdge.label}` : step.node.label}
                        className={[
                          'flex h-9 max-w-[220px] shrink-0 items-center gap-xs rounded-md border px-sm text-label-md transition-colors',
                          selectedNodePrototype?.node.id === step.node.id
                            ? 'border-tertiary bg-tertiary-container text-on-tertiary-container'
                            : 'border-outline-variant bg-surface-container-high text-on-surface-variant hover:text-on-surface',
                        ].join(' ')}
                      >
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-sm bg-surface/70 px-[5px] font-mono text-[10px]">
                          {step.sequenceIndex + 1}
                        </span>
                        <span className="min-w-0 truncate">{step.node.label}</span>
                        {step.outgoing.length > 0 ? (
                          <span className="rounded-sm bg-primary/15 px-[5px] font-mono text-[10px] text-primary">
                            {step.outgoing.length}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-xs">
                    <button
                      type="button"
                      onClick={() => previousPrototypeStep && setSelectedPrototypeNodeId(previousPrototypeStep.node.id)}
                      disabled={!previousPrototypeStep}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-35"
                      title={previousPrototypeStep ? `上一页：${previousPrototypeStep.node.label}` : '已经是第一个界面'}
                      aria-label="上一页"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_left</span>
                    </button>
                    <button
                      type="button"
                      data-prototype-flow-next="true"
                      onClick={() => nextPrototypeStep && setSelectedPrototypeNodeId(nextPrototypeStep.node.id)}
                      disabled={!nextPrototypeStep}
                      className="flex h-9 items-center gap-xs rounded-md border border-tertiary/50 bg-tertiary-container px-sm text-label-md text-tertiary transition-colors hover:bg-tertiary-container/80 disabled:cursor-not-allowed disabled:opacity-35"
                      title={nextPrototypeStep ? `下一页：${nextPrototypeStep.node.label}` : '已经到达流程末尾'}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                      下一页
                    </button>
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-xs text-body-sm text-on-surface-variant">
                  <span className="material-symbols-outlined shrink-0 text-tertiary" style={{ fontSize: '16px' }}>conversion_path</span>
                  <span className="min-w-0 truncate">
                    {prototypeFlowPreview.edges.length > 0
                      ? `已按 ${prototypeFlowPreview.edges.length} 条界面联系线串联，从入口界面开始预览`
                      : '当前没有可串联的界面联系线，暂按节点顺序预览'}
                  </span>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 bg-zinc-950 p-sm md:p-md">
                <div className="flex min-h-0 flex-1 gap-sm">
                  <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-zinc-950 shadow-inner">
                    <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-40" />
                    <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
                      <PrototypePreviewSurface
                        html={selectedNodePrototype?.html ?? null}
                        title={selectedNodePrototype ? `${selectedNodePrototype.node.label} HTML prototype` : 'HTML prototype'}
                        interactive
                        fit="fullPage"
                        surfaceClassName="h-full w-full"
                        flowEdges={selectedNodePrototype?.outgoing.map((edge) => ({
                          ...edge,
                          targetLabel: prototypeFlowStepByNodeId.get(edge.targetNodeId)?.node.label ?? null,
                        })) ?? []}
                        onFlowJump={(targetNodeId) => {
                          const targetStep = prototypeFlowStepByNodeId.get(targetNodeId)
                          if (targetStep) setSelectedPrototypeNodeId(targetStep.node.id)
                        }}
                        fallback={(
                          <div className="flex h-full items-center justify-center p-md text-center text-body-sm text-on-surface-variant">
                            还没有可展示的界面节点原型。
                          </div>
                        )}
                      />
                    </div>
                  </div>
                  <aside className="hidden w-[300px] shrink-0 flex-col overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-low text-on-surface lg:flex">
                    <div className="border-b border-outline-variant px-md py-sm">
                      <div className="font-label-md text-label-md text-on-surface-variant">当前界面</div>
                      <div className="mt-xs truncate font-title-md text-title-md text-on-surface">
                        {selectedNodePrototype?.node.label ?? '无可预览界面'}
                      </div>
                      <div className="mt-xs font-mono text-[11px] uppercase text-on-surface-variant">
                        {selectedNodePrototype ? `Step ${selectedNodePrototype.sequenceIndex + 1} / ${prototypeFlowSteps.length}` : 'Step 0 / 0'}
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 space-y-md overflow-y-auto px-md py-sm">
                      <section>
                        <h3 className="font-label-md text-label-md text-on-surface-variant">联系线跳转</h3>
                        <div className="mt-sm space-y-xs">
                          {selectedNodePrototype?.outgoing.length ? selectedNodePrototype.outgoing.map((edge) => {
                            const targetStep = prototypeFlowStepByNodeId.get(edge.targetNodeId)
                            return (
                              <button
                                key={edge.id}
                                type="button"
                                data-prototype-flow-edge={`${edge.sourceNodeId}->${edge.targetNodeId}`}
                                onClick={() => targetStep && setSelectedPrototypeNodeId(targetStep.node.id)}
                                disabled={!targetStep}
                                title={edge.reason ?? edge.label}
                                className="flex w-full min-w-0 flex-col rounded-md border border-secondary/45 bg-secondary-container/25 px-sm py-xs text-left transition-colors hover:border-secondary hover:bg-secondary-container/40 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <span className="line-clamp-1 font-label-md text-label-md text-secondary">{edge.label}</span>
                                <span className="mt-[2px] line-clamp-1 text-body-sm text-on-surface-variant">
                                  到 {targetStep?.node.label ?? edge.targetNodeId}
                                </span>
                              </button>
                            )
                          }) : (
                            <div className="rounded-md border border-outline-variant/45 bg-surface-container-high px-sm py-xs text-body-sm text-on-surface-variant">
                              当前界面没有继续向后的联系线。
                            </div>
                          )}
                        </div>
                      </section>

                      <section>
                        <h3 className="font-label-md text-label-md text-on-surface-variant">顺序预览</h3>
                        <div className="mt-sm grid grid-cols-2 gap-xs">
                          <button
                            type="button"
                            onClick={() => previousPrototypeStep && setSelectedPrototypeNodeId(previousPrototypeStep.node.id)}
                            disabled={!previousPrototypeStep}
                            className="rounded-md border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            上一页
                          </button>
                          <button
                            type="button"
                            onClick={() => nextPrototypeStep && setSelectedPrototypeNodeId(nextPrototypeStep.node.id)}
                            disabled={!nextPrototypeStep}
                            className="rounded-md border border-tertiary/50 bg-tertiary-container px-sm py-xs text-label-md text-tertiary transition-colors hover:bg-tertiary-container/80 disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            下一页
                          </button>
                        </div>
                        {selectedNodePrototype?.nextEdge ? (
                          <p className="mt-xs text-body-sm text-on-surface-variant">
                            下一步来自联系线：{selectedNodePrototype.nextEdge.label}
                          </p>
                        ) : null}
                      </section>
                    </div>
                  </aside>
                </div>
              </div>
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-t border-outline-variant bg-surface-container-low px-md py-sm text-label-md text-on-surface-variant md:px-lg">
                <div className="min-w-0 truncate">
                  当前流程：{selectedNodePrototype ? `${selectedNodePrototype.sequenceIndex + 1}/${prototypeFlowSteps.length} ${selectedNodePrototype.node.label}` : '无可预览界面'} · 共 {generatedNodePrototypes.length} 个已生成节点原型
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
      <div className="max-w-[560px] w-full mx-auto bg-surface-container-low border border-outline-variant rounded-xl p-8 shadow-2xl flex flex-col items-center gap-6">
        <div className="w-full transition-opacity duration-300">
          {stage === 'upload' ? (
            <UploadCard
              onImportSources={handleImportSources}
              onOpenArchive={() => { void handleOpenArchive() }}
              onConfigureEnvironment={() => setEnvironmentConfigOpen(true)}
              proxyBaseUrl={settings.proxyBaseUrl}
              error={uploadError ?? projectError}
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
