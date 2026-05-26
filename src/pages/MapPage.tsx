import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { startDecomposition, pollDecomposition } from '../lib/api'
import { useAppStore } from '../store/appStore'
import { UploadCard } from '../components/upload/UploadCard'
import { DecompProgress } from '../components/upload/DecompProgress'

type Stage = 'upload' | 'decomposing' | 'done' | 'error'

export function MapPage() {
  const [stage, setStage] = useState<Stage>('upload')
  const [isReading, setIsReading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [decompError, setDecompError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const sessionIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [, navigate] = useLocation()
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate })

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
    let lastStep = ''

    pollIntervalRef.current = setInterval(async () => {
      try {
        const data = await pollDecomposition(settings.proxyBaseUrl, sessionId)

        // Update node count live
        setNodeCount(data.nodeCount)

        // Merge new nodes into store
        if (data.nodes.length > 0) {
          const nodeMap = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
          mergePartialTree(nodeMap)
        }

        // Update step display
        if (data.currentStep !== lastStep) {
          const currentSteps = useAppStore.getState().decompositionSteps
          const lastActiveIdx = currentSteps.findLastIndex((s) => s.status === 'active')
          if (lastActiveIdx >= 0) {
            updateDecompositionStep(lastActiveIdx, { status: 'complete' })
          }

          if (data.status === 'running') {
            appendDecompositionStep({ label: data.currentStep, status: 'active' })
          }
          lastStep = data.currentStep
        }

        // Handle terminal states
        if (data.status === 'done') {
          clearPolling()
          const finalSteps = useAppStore.getState().decompositionSteps
          const finalActiveIdx = finalSteps.findLastIndex((s) => s.status === 'active')
          if (finalActiveIdx >= 0) updateDecompositionStep(finalActiveIdx, { status: 'complete' })
          appendDecompositionStep({ label: 'Complete', status: 'complete' })

          if (data.nodes.length > 0) {
            const finalTree = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
            setPrdTree(finalTree)
          }

          setDecompositionStatus('done')
          setStage('done')

          setTimeout(() => { navigateRef.current('/') }, 800)
        }

        if (data.status === 'error') {
          clearPolling()
          const errSteps = useAppStore.getState().decompositionSteps
          const errActiveIdx = errSteps.findLastIndex((s) => s.status === 'active')
          if (errActiveIdx >= 0) updateDecompositionStep(errActiveIdx, { status: 'error' })

          setDecompError(data.error ?? 'The AI did not return a valid tree structure. Try uploading again.')
          setDecompositionStatus('error')
          setStage('error')
        }
      } catch (err) {
        clearPolling()
        const msg = err instanceof Error ? err.message : 'Polling failed'
        setDecompError(msg)
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

    appendDecompositionStep({ label: 'Decomposing top-level modules', status: 'active' })

    try {
      const { sessionId } = await startDecomposition(settings.proxyBaseUrl, mdText)
      sessionIdRef.current = sessionId
      startPolling(sessionId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start decomposition'
      setDecompError(msg)
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
            <UploadCard onFileRead={handleFileRead} isReading={isReading} error={uploadError} />
          ) : stage === 'decomposing' || stage === 'done' ? (
            <DecompProgress steps={decompositionSteps} nodeCount={nodeCount} />
          ) : stage === 'error' && decompError ? (
            <DecompProgress steps={decompositionSteps} nodeCount={nodeCount} error={decompError} />
          ) : (
            <UploadCard onFileRead={handleFileRead} error={uploadError} />
          )}
        </div>
      </div>
    </div>
  )
}
