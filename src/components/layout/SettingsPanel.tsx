import { useEffect, useState } from 'react'
import { getProxyHealth, searchCocosRag } from '../../lib/api'
import { useAppStore } from '../../store/appStore'
import type { ProxyHealth, RagSearchResult } from '../../types/chat'

interface SettingsPanelProps {
  open: boolean
  onResetSession: () => void
  onResetRequirement: () => void
  onClose: () => void
}

export function SettingsPanel({ open, onResetSession, onResetRequirement, onClose }: SettingsPanelProps) {
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [health, setHealth] = useState<ProxyHealth | null>(null)
  const [ragResult, setRagResult] = useState<RagSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    if (!open) return

    getProxyHealth(settings.proxyBaseUrl)
      .then((data) => {
        setHealth(data)
        setError(null)
      })
      .catch((healthError) => {
        setHealth(null)
        setError(healthError instanceof Error ? healthError.message : '无法连接本地代理')
      })
  }, [open])

  async function handleTestRag() {
    setIsTesting(true)
    setError(null)
    try {
      setRagResult(await searchCocosRag(settings.proxyBaseUrl, settings.defaultRagQuery))
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'RAG 测试失败')
    } finally {
      setIsTesting(false)
    }
  }

  if (!open) return null

  const cocosRagStatus = health?.cocosRag.status === 'configured'
    ? '已配置'
    : health?.cocosRag.status ?? '待检测'
  const ragResultStatus = ragResult?.status === 'connected'
    ? '已连接'
    : ragResult?.status === 'error'
      ? '失败'
      : '模拟'

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-lg backdrop-blur-sm">
      <div className="w-full max-w-[720px] rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-[0_0_32px_rgba(0,0,0,0.4)]">
        <div className="mb-lg flex items-start justify-between">
          <div>
            <div className="font-mono text-label-md uppercase text-secondary">系统配置</div>
            <h2 className="mt-xs text-headline-md font-semibold text-on-surface">AI 与 Cocos RAG 设置</h2>
          </div>
          <button onClick={onClose} className="rounded-md border border-outline-variant/50 px-sm py-xs font-mono text-code-sm text-on-surface-variant hover:bg-surface-container-high">
            关闭
          </button>
        </div>

        {error ? <div className="mb-md rounded-lg border border-error/30 bg-error/10 p-sm font-mono text-code-sm text-error">{error}</div> : null}

        <div className="grid gap-md md:grid-cols-2">
          <ConfigBlock label="Claude 服务" value={health?.claude.provider ?? 'Anthropic Claude'} status={health?.claude.apiKeyPresent ? 'API Key 已配置' : '缺少 API Key'} tone={health?.claude.apiKeyPresent ? 'complete' : 'missing'} />
          <ConfigBlock label="模型" value={health?.claude.model ?? 'claude-sonnet-4-6'} status="自适应思考 + Prompt 缓存" tone="info" />
          <ConfigBlock label="本地代理" value="http://127.0.0.1:8787" status={health?.ok ? '已连接' : '未连接'} tone={health?.ok ? 'complete' : 'missing'} />
          <ConfigBlock label="Cocos RAG SSE" value={health?.cocosRag.sseUrl ?? 'http://43.134.44.85:18000/sse'} status={cocosRagStatus} tone="info" />
        </div>

        <div className="mt-md rounded-xl border border-outline-variant/30 bg-surface/60 p-md">
          <div className="font-mono text-label-md uppercase text-on-surface-variant">MCP 代理脚本</div>
          <div className="mt-xs break-all font-mono text-code-sm text-on-surface">{health?.cocosRag.proxyScript ?? '%APPDATA%\\cocos-rag\\remote_proxy.py'}</div>
        </div>

        <div className="mt-md grid gap-md md:grid-cols-2">
          <EditableField label="项目名称" value={settings.projectName} onChange={(value) => updateSettings({ ...settings, projectName: value })} />
          <EditableField label="代理地址" value={settings.proxyBaseUrl} onChange={(value) => updateSettings({ ...settings, proxyBaseUrl: value })} />
        </div>

        <div className="mt-md">
          <EditableField label="默认 RAG 查询" value={settings.defaultRagQuery} onChange={(value) => updateSettings({ ...settings, defaultRagQuery: value })} />
        </div>

        <div className="mt-lg flex flex-wrap items-center justify-between gap-md">
          <div className="flex flex-wrap gap-sm">
            <button
              onClick={handleTestRag}
              disabled={isTesting}
              className="rounded-lg bg-secondary-container px-md py-sm font-mono text-label-md uppercase text-on-secondary-container shadow-[0_0_12px_rgba(5,102,217,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isTesting ? '正在测试 RAG' : '测试 Cocos RAG'}
            </button>
            <button onClick={onResetSession} className="rounded-lg border border-outline-variant/40 px-md py-sm font-mono text-label-md uppercase text-on-surface-variant hover:bg-surface-container-high">
              重置对话
            </button>
            <button onClick={onResetRequirement} className="rounded-lg border border-outline-variant/40 px-md py-sm font-mono text-label-md uppercase text-on-surface-variant hover:bg-surface-container-high">
              重置需求
            </button>
          </div>
          <span className="font-mono text-code-sm text-on-surface-variant">密钥仅保存在 .env 和本地代理中。</span>
        </div>

        {ragResult ? (
          <div className="mt-md rounded-xl border border-secondary/40 bg-secondary/10 p-md">
            <div className="font-mono text-label-md uppercase text-secondary">RAG 结果 · {ragResultStatus}</div>
            <p className="mt-sm text-body-md text-on-surface">{ragResult.answer}</p>
            <div className="mt-sm font-mono text-code-sm text-on-surface-variant">
              {ragResult.references.map((reference) => `${reference.title}: ${reference.source}`).join(' · ')}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ConfigBlock({ label, value, status, tone }: { label: string; value: string; status: string; tone: 'complete' | 'missing' | 'info' }) {
  const toneClass = tone === 'complete' ? 'text-tertiary border-tertiary/30 bg-tertiary/10' : tone === 'missing' ? 'text-error border-error/30 bg-error/10' : 'text-secondary border-secondary/30 bg-secondary/10'

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface/60 p-md">
      <div className="font-mono text-label-md uppercase text-on-surface-variant">{label}</div>
      <div className="mt-xs break-all font-mono text-code-sm text-on-surface">{value}</div>
      <div className={`mt-sm inline-flex rounded-full border px-sm py-xs font-mono text-[10px] uppercase ${toneClass}`}>{status}</div>
    </div>
  )
}

function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-xl border border-outline-variant/30 bg-surface/60 p-md">
      <div className="font-mono text-label-md uppercase text-on-surface-variant">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-sm w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-sm py-sm font-mono text-code-sm text-on-surface outline-none focus:border-secondary"
      />
    </label>
  )
}
