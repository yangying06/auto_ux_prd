import { useLocation, useParams } from 'wouter'
import { AppShell } from '../components/layout/AppShell'
import { useAppStore } from '../store/appStore'

export function ForgePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const [, navigate] = useLocation()
  const node = useAppStore((s) => s.prdTree?.[nodeId ?? ''] ?? null)
  const updateNodeStatus = useAppStore((s) => s.updateNodeStatus)

  if (!node) {
    navigate('/')
    return null
  }

  function handleConfirm() {
    if (!nodeId) return
    updateNodeStatus(nodeId, 'done')
    navigate('/')
  }

  return <AppShell onBack={() => navigate('/')} onConfirm={handleConfirm} />
}
