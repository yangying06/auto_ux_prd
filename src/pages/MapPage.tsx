import { useEffect, useRef, useState } from 'react'
import { startDecomposition, pollDecomposition } from '../lib/api'
import { useAppStore } from '../store/appStore'
import { UploadCard } from '../components/upload/UploadCard'
import { DecompProgress } from '../components/upload/DecompProgress'

type Stage = 'upload' | 'decomposing' | 'done' | 'error'

const INITIAL_STEP = '正在识别顶层模块...'

function findLastActiveIdx(steps: Array<{ status: string }>) {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'active') return i
  }
  return -1
}

export function MapPage() {
  const [stage, setStage] = useState<Stage>('upload')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [decompError, setDecompError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const sessionIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const settings = useAppStore((s) => s.settings)
  const decompositionSteps = useAppStore((s) => s.decompositionSteps)
  const mergePartialTree = useAppStore((s) => s.mergePartialTree)
  const setDecompositionStatus = useAppStore((s) => s.setDecompositionStatus)
  const appendDecompositionStep = useAppStore((s) => s.appendDecompositionStep)
  const updateDecompositionStep = useAppStore((s) => s.updateDecompositionStep)
  const resetDecomposition = useAppStore((s) => s.resetDecomposition)
  const setPrdTree = useAppStore((s) => s.setPrdTree)

  const clearPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  const startPolling = (sessionId: string) => {
    // Initialize to the label we pre-added so first poll doesn't duplicate it
    let lastStep = INITIAL_STEP

    pollIntervalRef.current = setInterval(async () => {
      try {
        const data = await pollDecomposition(settings.proxyBaseUrl, sessionId)

        setNodeCount(data.nodeCount)

        if (data.nodes.length > 0) {
          const nodeMap = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
          mergePartialTree(nodeMap)
        }

        // Advance step display when server moves to a new step
        if (data.currentStep !== lastStep) {
          const currentSteps = useAppStore.getState().decompositionSteps
          const activeIdx = findLastActiveIdx(currentSteps)
          if (activeIdx >= 0) updateDecompositionStep(activeIdx, { status: 'complete' })

          if (data.status === 'running') {
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

          if (data.nodes.length > 0) {
            const finalTree = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
            setPrdTree(finalTree)
          }

          setDecompositionStatus('done')
          setStage('done')
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
        clearPolling()
        setDecompError(err instanceof Error ? err.message : '轮询失败')
        setDecompositionStatus('error')
        setStage('error')
      }
    }, 1500)
  }

  const handleFileRead = async (mdText: string) => {
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

  useEffect(() => {
    return () => { clearPolling() }
  }, [])

  return (
    <div className="w-full h-screen flex items-center justify-center bg-background blueprint-grid overflow-hidden">
      <div className="max-w-[480px] w-full mx-auto bg-surface-container-low border border-outline-variant rounded-xl p-12 shadow-2xl flex flex-col items-center gap-6">
        <div className="w-full transition-opacity duration-300">
          {stage === 'upload' ? (
            <UploadCard onFileRead={handleFileRead} error={uploadError} />
          ) : stage === 'decomposing' || stage === 'done' ? (
            <DecompProgress steps={decompositionSteps} nodeCount={nodeCount} isDone={stage === 'done'} />
          ) : (
            <DecompProgress steps={decompositionSteps} nodeCount={nodeCount} error={decompError} />
          )}
        </div>
      </div>
    </div>
  )
}
