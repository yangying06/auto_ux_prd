import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { getAiEnvironmentConfig, previewDecomposition, startDecomposition, pollDecomposition, exportSpecFolder, exportNodeMarkdown, suggestPrdNodeOperations } from '../lib/api'
import { MapAdjustmentPanel } from '../components/map/MapAdjustmentPanel'
import type { PrdImportPreview, PrdNode, PrdNodeOperationSuggestion, PrdTree } from '../types/prdNode'
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
import { openProjectArchiveFile, saveProjectArchiveBytes } from '../lib/archiveIO'
import { createProjectWorkspaceSnapshot } from '../lib/archiveSnapshot'
import { AddNodeModal, type AddNodePayload } from '../components/map/AddNodeModal'
import { buildDeliveryDisplayTree, collectDeliveryNodes, isDeliveryNode } from '../lib/prdNodeDelivery'
import { EnvironmentConfigModal } from '../components/map/EnvironmentConfigModal'

type Stage = 'upload' | 'preview' | 'decomposing' | 'error' | 'map'

const INITIAL_STEP = '正在建立原文索引'
const POLL_INTERVAL_MS = 700
const EMPTY_NODE_SUGGESTIONS: PrdNodeOperationSuggestion[] = []

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

function canForgeNode(node: PrdNode | null, tree: PrdTree | null | undefined) {
  return Boolean(node && isDeliveryNode(node, tree) && (node.needsPolish || node.status === 'done'))
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

function getPrimaryRootId(tree: PrdTree) {
  return Object.values(tree)
    .filter((node) => node.parentId === null)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0]?.id ?? null
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

export function MapPage() {
  const [stage, setStage] = useState<Stage>(() =>
    Object.keys(useAppStore.getState().prdTree ?? {}).length > 0 ? 'map' : 'upload'
  )
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [decompError, setDecompError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [pendingMdText, setPendingMdText] = useState<string | null>(null)
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
  const [environmentStatus, setEnvironmentStatus] = useState<AiEnvironmentConfig | null>(null)
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
  const qaIssues = useAppStore((s) => s.qaIssues)
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
  const updateNodeContent = useAppStore((s) => s.updateNodeContent)
  const deleteNode = useAppStore((s) => s.deleteNode)
  const createQaIssue = useAppStore((s) => s.createQaIssue)
  const applyMapAdjustmentOperations = useAppStore((s) => s.applyMapAdjustmentOperations)
  const setNodeOperationSuggestions = useAppStore((s) => s.setNodeOperationSuggestions)
  const dismissNodeOperationSuggestion = useAppStore((s) => s.dismissNodeOperationSuggestion)
  const applyNodeOperationSuggestion = useAppStore((s) => s.applyNodeOperationSuggestion)
  const setNodeDocPath = useAppStore((s) => s.setNodeDocPath)
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId)
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
    setPendingMdText(null)
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
      setProjectError(err instanceof Error ? err.message : '保存项目存档失败')
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
      setProjectError(err instanceof Error ? err.message : '打开项目存档失败')
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

  const beginDecomposition = async (mdText: string) => {
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
      const { sessionId } = await startDecomposition(settings.proxyBaseUrl, mdText)
      sessionIdRef.current = sessionId
      startPolling(sessionId)
    } catch (err) {
      setDecompError(err instanceof Error ? err.message : '无法启动拆解任务')
      setStage('error')
      setDecompositionStatus('error')
    }
  }

  const handleFileRead = async (mdText: string, filename: string) => {
    clearPolling()
    sessionIdRef.current = null
    resetProject()
    resetDecomposition()
    setUploadError(null)
    setDecompError(null)
    setProjectError(null)
    setNodeCount(0)
    setSourceDocument({ filename, text: mdText, importedAt: new Date().toISOString() })
    setPendingMdText(mdText)
    setImportPreview(null)
    setPreviewError(null)
    setIsPreviewLoading(true)
    setStage('preview')
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId

    try {
      const preview = await previewDecomposition(settings.proxyBaseUrl, mdText)
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
    if (!pendingMdText) return
    void beginDecomposition(pendingMdText)
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

  if (stage === 'map' && prdTree) {
    const selectedNode = selectedNodeId ? (prdTree[selectedNodeId] ?? null) : null
    const displayTree = buildDeliveryDisplayTree(prdTree)

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

    const handleExport = async () => {
      setIsExporting(true)
      setExportError(null)
      try {
        const result = await exportSpecFolder(settings.proxyBaseUrl, prdTree)
        for (const doc of result.documents) {
          setNodeDocPath(doc.nodeId, doc.docPath)
        }
        alert(`已导出页面级 spec 文件夹：${result.exportDir}`)
      } catch (err) {
        setExportError(err instanceof Error ? err.message : '导出失败，请重试')
      } finally {
        setIsExporting(false)
      }
    }

    const handleOpenAddNode = (parentId: string | null) => {
      setAddNodeParentId(parentId ?? getPrimaryRootId(prdTree))
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
      const parentId = addNodeParentId && prdTree[addNodeParentId] ? addNodeParentId : getPrimaryRootId(prdTree)

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
        setSelectedNodeId(newNodeId)
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
          onOpenQa={handleOpenQaFromToolbar}
          qaOpenIssueCount={qaOpenIssueCount}
        />
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
              selectedNodeId={selectedNodeId}
              onNodeClick={(id) => setSelectedNodeId(id)}
              onNodeDoubleClick={(id) => {
                const node = prdTree[id]
                if (!canForgeNode(node, prdTree)) {
                  setSelectedNodeId(id)
                  return
                }
                setSelectedNodeId(null)
                navigate('/forge/' + id)
              }}
              onAddNode={handleOpenAddNode}
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
          />
        </main>
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
                    汇总各界面节点已生成的 HTML 原型，用于进入 Cocos 编码前确认流程、状态和反馈边界；Prefab 仍由 Figma 通过 figma2prefab 生成。
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
              onFileRead={handleFileRead}
              onOpenArchive={() => { void handleOpenArchive() }}
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
