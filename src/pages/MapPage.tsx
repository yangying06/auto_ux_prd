import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { startDecomposition, pollDecomposition, exportSpecFolder, exportNodeMarkdown } from '../lib/api'
import { MapAdjustmentPanel } from '../components/map/MapAdjustmentPanel'
import type { PrdNode, PrdTree } from '../types/prdNode'
import { openBoltWithPrompt, prdTreeToBoltPrompt } from '../lib/specPrompt'
import { useAppStore } from '../store/appStore'
import { UploadCard } from '../components/upload/UploadCard'
import { DecompProgress } from '../components/upload/DecompProgress'
import { DecompLiveCanvas } from '../components/upload/DecompLiveCanvas'
import { TopAppBar } from '../components/map/TopAppBar'
import { TreeCanvas } from '../components/map/TreeCanvas'
import { PreviewDrawer } from '../components/map/PreviewDrawer'

type Stage = 'upload' | 'decomposing' | 'error' | 'map'

const INITIAL_STEP = '正在通读原文并建立结构'
const POLL_INTERVAL_MS = 700

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

function canForgeNode(node: PrdNode | null) {
  return Boolean(node && node.type === 'page' && (node.needsPolish || node.status === 'done'))
}

function completionGateNodes(tree: PrdTree) {
  const nodes = Object.values(tree)
  const leaves = nodes.filter((node) => node.children.length === 0)
  return leaves.length ? leaves : nodes
}

function allCompletionGateNodesDone(tree: PrdTree) {
  const targets = completionGateNodes(tree)
  return targets.length > 0 && targets.every((node) => node.status === 'done')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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
  const sessionIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInFlightRef = useRef(false)

  const [, navigate] = useLocation()

  const prdTree = useAppStore((s) => s.prdTree)
  const settings = useAppStore((s) => s.settings)
  const decompositionSteps = useAppStore((s) => s.decompositionSteps)
  const setDecompositionStatus = useAppStore((s) => s.setDecompositionStatus)
  const appendDecompositionStep = useAppStore((s) => s.appendDecompositionStep)
  const updateDecompositionStep = useAppStore((s) => s.updateDecompositionStep)
  const resetDecomposition = useAppStore((s) => s.resetDecomposition)
  const setPrdTree = useAppStore((s) => s.setPrdTree)
  const createPageNode = useAppStore((s) => s.createPageNode)
  const updateNodeContent = useAppStore((s) => s.updateNodeContent)
  const deleteNode = useAppStore((s) => s.deleteNode)
  const applyMapAdjustmentOperations = useAppStore((s) => s.applyMapAdjustmentOperations)
  const setNodeDocPath = useAppStore((s) => s.setNodeDocPath)
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)

  const clearPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    pollInFlightRef.current = false
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

  const handleFileRead = async (mdText: string) => {
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

  const handleReset = () => {
    clearPolling()
    sessionIdRef.current = null
    resetDecomposition()
    setStage('upload')
    setDecompError(null)
    setNodeCount(0)
    setSelectedNodeId(null)
  }

  useEffect(() => {
    return () => { clearPolling() }
  }, [])

  if (stage === 'map' && prdTree) {
    const selectedNode = selectedNodeId ? (prdTree[selectedNodeId] ?? null) : null

    const canExport = allCompletionGateNodesDone(prdTree)

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

    const handleCreatePage = () => {
      const title = window.prompt('请输入页面名称，例如：主界面、规则页、排行榜')
      if (!title?.trim()) return
      createPageNode({ title, parentId: selectedNode?.id ?? null })
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

    const handleValidatePrototype = () => {
      if (!canExport) {
        setExportError('所有叶子文档包标记为已完成后才能 Bolt 验证')
        return
      }
      openBoltWithPrompt(prdTreeToBoltPrompt(prdTree))
    }

    return (
      <div className="w-full h-screen flex flex-col bg-background animate-fade-in overflow-hidden">
        <TopAppBar
          onUploadNew={handleReset}
          onDelete={() => {
            if (window.confirm('确定要删除当前项目吗？所有节点和进度将被清除。')) {
              handleReset()
            }
          }}
          canExport={canExport}
          onExport={handleExport}
          isExporting={isExporting}
          onValidatePrototype={handleValidatePrototype}
          canValidatePrototype={canExport}
        />
        {exportError && (
          <div className="bg-error/10 border-b border-error/30 px-lg py-sm text-error font-label-md text-label-md flex items-center gap-sm">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>error</span>
            {exportError}
            <button
              onClick={() => setExportError(null)}
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
            <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-md py-sm">
              <div className="text-label-md text-on-surface-variant">页面级导图：单击查看，双击打磨</div>
              <button
                onClick={handleCreatePage}
                className="rounded-lg bg-primary px-md py-sm text-label-md text-on-primary hover:bg-primary/90"
              >
                新建页面
              </button>
            </div>
            <TreeCanvas
              tree={prdTree}
              selectedNodeId={selectedNodeId}
              onNodeClick={(id) => setSelectedNodeId(id)}
              onNodeDoubleClick={(id) => {
                const node = prdTree[id]
                if (!canForgeNode(node)) {
                  setSelectedNodeId(id)
                  return
                }
                setSelectedNodeId(null)
                navigate('/forge/' + id)
              }}
            />
          </div>
          <PreviewDrawer
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onDelete={handleDeleteNode}
            onOpenDoc={handleOpenDoc}
            onUpdateContent={updateNodeContent}
          />
        </main>
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
      </div>
    )
  }

  return (
    <div className="w-full h-screen flex items-center justify-center bg-background blueprint-grid overflow-hidden">
      <div className="max-w-[480px] w-full mx-auto bg-surface-container-low border border-outline-variant rounded-xl p-12 shadow-2xl flex flex-col items-center gap-6">
        <div className="w-full transition-opacity duration-300">
          {stage === 'upload' ? (
            <UploadCard onFileRead={handleFileRead} error={uploadError} />
          ) : (
            <DecompProgress steps={decompositionSteps} nodeCount={nodeCount} error={decompError} />
          )}
        </div>
      </div>
    </div>
  )
}
