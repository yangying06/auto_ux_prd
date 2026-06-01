import { useState, useEffect, useRef } from 'react'
import { ChatPanel } from '../chat/ChatPanel'
import { StateCanvas } from '../state/StateCanvas'
import { SettingsPanel } from './SettingsPanel'
import { useAppStore } from '../../store/appStore'
import { exportFinalPrompt, generatePrototype } from '../../lib/api'
import { downloadMarkdown } from '../../lib/download'
import { openBoltWithPrompt, requirementToBoltPrompt } from '../../lib/specPrompt'
import type { ContentBlock } from '../../types/chat'

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('\n')
}

export function AppShell({ onBack, onConfirm }: { onBack?: () => void; onConfirm?: () => void } = {}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isGeneratingPrototype, setIsGeneratingPrototype] = useState(false)
  const [isExportingPrompt, setIsExportingPrompt] = useState(false)
  const [specMarkdown, setSpecMarkdown] = useState<string | null>(null)
  const requirement = useAppStore((state) => state.requirement)
  const messages = useAppStore((state) => state.messages)
  const latestRag = useAppStore((state) => state.latestRag)
  const settings = useAppStore((state) => state.settings)
  const prototypeHtml = useAppStore((state) => state.prototypeHtml)
  const prototypeHistory = useAppStore((state) => state.prototypeHistory)
  const setPrototypeHtml = useAppStore((state) => state.setPrototypeHtml)
  const restorePrototypeVersion = useAppStore((state) => state.restorePrototypeVersion)
  const resetSession = useAppStore((state) => state.resetSession)
  const resetRequirement = useAppStore((state) => state.resetRequirement)

  // Auto-generate prototype when completion_rate first crosses 60%
  const lastAutoGenRate = useRef(0)
  useEffect(() => {
    const rate = requirement.completion_rate
    if (rate >= 60 && lastAutoGenRate.current < 60 && !isGeneratingPrototype && !prototypeHtml) {
      handleGeneratePrototype()
    }
    lastAutoGenRate.current = rate
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement.completion_rate])

  async function handleGeneratePrototype(instruction?: string) {
    const trimmedInstruction = instruction?.trim() ?? ''
    setIsGeneratingPrototype(true)
    try {
      const result = await generatePrototype(settings.proxyBaseUrl, requirement, {
        currentHtml: trimmedInstruction ? prototypeHtml : null,
        instruction: trimmedInstruction,
      })
      const chosen = result.variants.find((variant) => variant.status === 'complete' && variant.html)
      if (chosen?.html) {
        setPrototypeHtml(chosen.html, {
          mode: chosen.mode === 'create' ? 'create' : 'update',
          note: trimmedInstruction || null,
        })
      }
    } finally {
      setIsGeneratingPrototype(false)
    }
  }

  function handleOpenBolt() {
    openBoltWithPrompt(requirementToBoltPrompt(requirement))
  }

  async function handleExportPrompt() {
    setIsExportingPrompt(true)
    try {
      const summary = messages.map((m) => `[${m.role}] ${extractText(m.content)}`).join('\n')
      const result = await exportFinalPrompt(settings.proxyBaseUrl, requirement, summary)
      setSpecMarkdown(result.markdown)
    } catch (err) {
      console.error('Export failed:', err)
      alert(`导出失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExportingPrompt(false)
    }
  }

  async function handleDownloadSpec() {
    if (!specMarkdown) return
    const timestamp = new Date().toISOString().slice(0, 10)
    await downloadMarkdown(`交互设计-${settings.projectName}-${timestamp}.md`, specMarkdown)
  }

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background text-on-background font-body text-body-md antialiased">
      <ChatPanel onOpenSettings={() => setSettingsOpen(true)} onBack={onBack} onConfirm={onConfirm} />
      <StateCanvas
        requirement={requirement}
        latestRag={latestRag}
        projectName={settings.projectName}
        prototypeHtml={prototypeHtml}
        prototypeHistory={prototypeHistory}
        isGeneratingPrototype={isGeneratingPrototype}
        isExportingPrompt={isExportingPrompt}
        onGeneratePrototype={handleGeneratePrototype}
        onRestorePrototype={restorePrototypeVersion}
        onExportPrompt={handleExportPrompt}
        onOpenBolt={handleOpenBolt}
      />
      <SettingsPanel
        open={settingsOpen}
        onResetSession={resetSession}
        onResetRequirement={resetRequirement}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Spec Preview Modal */}
      {specMarkdown ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex h-[85vh] w-[75vw] flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-high px-lg py-md">
              <span className="font-mono text-label-md uppercase text-secondary">Cocos UX Spec · 预览</span>
              <div className="flex items-center gap-sm">
                <button
                  onClick={handleDownloadSpec}
                  className="rounded-lg border border-secondary/40 bg-secondary/10 px-md py-xs font-mono text-code-sm text-secondary transition-colors hover:bg-secondary/20"
                >
                  下载 .md
                </button>
                <button
                  onClick={() => setSpecMarkdown(null)}
                  className="rounded-md px-sm py-xs font-mono text-code-sm text-on-surface-variant hover:text-error"
                >
                  ✕ 关闭
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-lg font-mono text-code-sm text-on-surface leading-relaxed">
              {specMarkdown}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
