import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { QaDrawer } from '../components/qa/QaDrawer'
import { useAppStore } from '../store/appStore'

export function QaPage() {
  const [, navigate] = useLocation()
  const prdTree = useAppStore((s) => s.prdTree)
  const settings = useAppStore((s) => s.settings)
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)

  useEffect(() => {
    if (!prdTree || Object.keys(prdTree).length === 0) navigate('/')
  }, [navigate, prdTree])

  if (!prdTree || Object.keys(prdTree).length === 0) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-body-md text-on-surface-variant">
        正在返回导图...
      </div>
    )
  }

  return (
    <QaDrawer
      baseUrl={settings.proxyBaseUrl}
      tree={prdTree}
      activeIssueId={activeIssueId}
      onActiveIssueChange={setActiveIssueId}
      onClose={() => navigate('/')}
    />
  )
}
