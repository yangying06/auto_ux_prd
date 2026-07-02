import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { saveAiEnvironmentConfig } from '../../lib/api'
import type { AiEnvironmentConfig, AiEnvironmentUpdate } from '../../types/chat'

const DEFAULT_LARK_CONFIG = {
  cliBin: 'lark-cli',
  identity: 'user',
  appId: 'cli_a94134a342395cd2',
  appSecret: 'YA5QaoERLCV95rZjtKRb5bz6DWItAXei',
} as const

const configCommand = `lark-cli config init --app-id "${DEFAULT_LARK_CONFIG.appId}" --app-secret-stdin --brand feishu`
const loginCommand = 'lark-cli auth login --recommend'

interface EnvironmentConfigModalProps {
  open: boolean
  required?: boolean
  baseUrl: string
  status: AiEnvironmentConfig | null
  onSaved: (status: AiEnvironmentConfig) => void
  onClose: () => void
}

export function EnvironmentConfigModal({
  open,
  required = false,
  baseUrl,
  status,
  onSaved,
  onClose,
}: EnvironmentConfigModalProps) {
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [anthropicApiKeyTouched, setAnthropicApiKeyTouched] = useState(false)
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('https://litellm.wenext.technology/')
  const [claudeModel, setClaudeModel] = useState('gpt-5.5')
  const [mockDecompose, setMockDecompose] = useState(false)
  const [figmaToken, setFigmaToken] = useState('')
  const [figmaTokenTouched, setFigmaTokenTouched] = useState(false)
  const [larkCliBin, setLarkCliBin] = useState<string>(DEFAULT_LARK_CONFIG.cliBin)
  const [larkAppId, setLarkAppId] = useState<string>(DEFAULT_LARK_CONFIG.appId)
  const [larkAppIdTouched, setLarkAppIdTouched] = useState(false)
  const [larkAppSecret, setLarkAppSecret] = useState<string>(DEFAULT_LARK_CONFIG.appSecret)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setAnthropicApiKey('')
    setAnthropicApiKeyTouched(false)
    setAnthropicBaseUrl(status?.values.ANTHROPIC_BASE_URL || 'https://litellm.wenext.technology/')
    setClaudeModel(status?.values.CLAUDE_MODEL || 'gpt-5.5')
    setMockDecompose(status?.values.MOCK_DECOMPOSE ?? false)
    setFigmaToken('')
    setFigmaTokenTouched(false)
    setLarkCliBin(status?.values.LARK_CLI_BIN || DEFAULT_LARK_CONFIG.cliBin)
    setLarkAppId(status?.values.LARK_APP_ID || DEFAULT_LARK_CONFIG.appId)
    setLarkAppIdTouched(false)
    setLarkAppSecret(status?.values.LARK_APP_SECRET_PRESENT ? '' : DEFAULT_LARK_CONFIG.appSecret)
    setError(null)
  }, [open, status])

  if (!open) return null

  const apiKeyMissing = !status?.values.ANTHROPIC_API_KEY_PRESENT
  const figmaMissing = !status?.values.FIGMA_TOKEN_PRESENT
  const larkAppIdMissing = !status?.values.LARK_APP_ID_PRESENT
  const larkAppSecretMissing = !status?.values.LARK_APP_SECRET_PRESENT

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      const nextAnthropicApiKey = anthropicApiKey.trim()
      const nextFigmaToken = figmaToken.trim()
      const nextLarkAppSecret = larkAppSecret.trim()
      const payload: AiEnvironmentUpdate = {
        ANTHROPIC_BASE_URL: anthropicBaseUrl.trim() || 'https://litellm.wenext.technology/',
        CLAUDE_MODEL: claudeModel.trim() || 'gpt-5.5',
        MOCK_DECOMPOSE: mockDecompose,
        LARK_CLI_BIN: larkCliBin.trim() || DEFAULT_LARK_CONFIG.cliBin,
        LARK_IDENTITY: DEFAULT_LARK_CONFIG.identity,
        ...(anthropicApiKeyTouched && nextAnthropicApiKey ? { ANTHROPIC_API_KEY: nextAnthropicApiKey } : {}),
        ...(figmaTokenTouched && nextFigmaToken ? { FIGMA_TOKEN: nextFigmaToken } : {}),
        ...(larkAppIdTouched || larkAppIdMissing
          ? { LARK_APP_ID: larkAppId.trim() || DEFAULT_LARK_CONFIG.appId }
          : {}),
        ...(nextLarkAppSecret || larkAppSecretMissing
          ? { LARK_APP_SECRET: nextLarkAppSecret || DEFAULT_LARK_CONFIG.appSecret }
          : {}),
      }
      const nextStatus = await saveAiEnvironmentConfig(baseUrl, payload)
      onSaved(nextStatus)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存环境配置失败')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/65 p-lg backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-md border-b border-outline-variant bg-surface-container-low px-lg py-md">
          <div>
            <div className="font-mono text-label-md uppercase text-secondary">ENV</div>
            <h2 className="mt-xs text-headline-sm font-semibold text-on-surface">环境配置</h2>
            <p className="mt-xs text-body-sm text-on-surface-variant">
              配置 AI、Figma 和飞书文档读取所需的本地环境变量。
            </p>
          </div>
          {!required ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:text-on-surface"
              aria-label="关闭环境配置"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-lg">
          {error ? (
            <div className="mb-md break-words rounded-lg border border-error/30 bg-error/10 p-sm text-body-sm text-error [overflow-wrap:anywhere]">
              {error}
            </div>
          ) : null}

          <div className="grid gap-md">
            <ConfigSection title="AI 模型" icon="psychology">
              <SecretField
                label="ANTHROPIC_API_KEY"
                description="用于 PRD 拆解、节点打磨和原型生成；已配置时留空会保持不变。"
                value={anthropicApiKey}
                present={!apiKeyMissing}
                preview={status?.values.ANTHROPIC_API_KEY_PREVIEW ?? null}
                required={required && apiKeyMissing}
                onChange={(value) => {
                  setAnthropicApiKey(value)
                  setAnthropicApiKeyTouched(true)
                }}
              />
              <TextField
                label="ANTHROPIC_BASE_URL"
                description="默认使用项目现有的 LiteLLM 网关。"
                value={anthropicBaseUrl}
                onChange={setAnthropicBaseUrl}
              />
              <TextField
                label="CLAUDE_MODEL"
                description="默认模型名。"
                value={claudeModel}
                onChange={setClaudeModel}
              />
              <label className="flex items-center justify-between gap-md rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
                <div>
                  <span className="font-mono text-code-sm text-on-surface">MOCK_DECOMPOSE</span>
                  <p className="mt-xs text-body-sm text-on-surface-variant">本地调试时可跳过真实 AI 拆解调用。</p>
                </div>
                <input
                  type="checkbox"
                  checked={mockDecompose}
                  onChange={(event) => setMockDecompose(event.target.checked)}
                  className="h-5 w-5 accent-secondary"
                />
              </label>
            </ConfigSection>

            <ConfigSection title="Figma" icon="polyline">
              <SecretField
                label="FIGMA_TOKEN"
                description="用于读取 Figma 设计稿和截图；已配置时留空会保持不变。"
                value={figmaToken}
                present={!figmaMissing}
                preview={status?.values.FIGMA_TOKEN_PREVIEW ?? null}
                required={false}
                onChange={(value) => {
                  setFigmaToken(value)
                  setFigmaTokenTouched(true)
                }}
              />
            </ConfigSection>

            <ConfigSection title="飞书文档读取" icon="article">
              <div className="rounded-lg border border-secondary/30 bg-secondary-container/20 p-md">
                <div className="flex items-center gap-sm text-label-md font-semibold text-on-surface">
                  <span className="material-symbols-outlined text-secondary" style={{ fontSize: '18px' }}>verified_user</span>
                  默认团队应用
                </div>
                <p className="mt-xs text-body-sm text-on-surface-variant">
                  App ID 和 App Secret 已预填；如果本机还没有授权，按下面两条命令完成一次初始化和登录。
                </p>
                <div className="mt-sm grid gap-sm">
                  <CommandBlock label="初始化应用" value={configCommand} />
                  <CommandBlock label="粘贴 App Secret" value={DEFAULT_LARK_CONFIG.appSecret} />
                  <CommandBlock label="授权登录" value={loginCommand} />
                </div>
              </div>

              <TextField
                label="LARK_CLI_BIN"
                description="默认使用 PATH 中的 lark-cli；如果安装在自定义位置，可填完整路径。"
                value={larkCliBin}
                onChange={setLarkCliBin}
              />
              <TextField
                label="LARK_APP_ID"
                description="团队共用飞书应用 ID。"
                value={larkAppId}
                present={!larkAppIdMissing}
                onChange={(value) => {
                  setLarkAppId(value)
                  setLarkAppIdTouched(true)
                }}
              />
              <SecretField
                label="LARK_APP_SECRET"
                description="团队共用飞书应用密钥；已配置时留空会保持不变。"
                value={larkAppSecret}
                present={!larkAppSecretMissing}
                preview={status?.values.LARK_APP_SECRET_PREVIEW ?? null}
                required={larkAppSecretMissing}
                onChange={setLarkAppSecret}
              />
              <div className="flex items-center justify-between gap-md rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
                <div>
                  <div className="font-mono text-code-sm text-on-surface-variant">LARK_IDENTITY</div>
                  <p className="mt-xs text-body-sm text-on-surface-variant">读取用户可访问的飞书文档。</p>
                </div>
                <span className="rounded-full border border-tertiary/30 bg-tertiary/10 px-sm py-xs font-mono text-code-sm text-tertiary">
                  user
                </span>
              </div>
            </ConfigSection>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-md border-t border-outline-variant bg-surface-container-low px-lg py-md">
          <span className="min-w-0 truncate font-mono text-code-sm text-on-surface-variant">{status?.envPath ?? '.env'}</span>
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-sm rounded-lg bg-secondary-container px-md py-sm font-label-md text-label-md text-on-secondary-container transition-colors hover:bg-secondary-container/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={['material-symbols-outlined', isSaving ? 'animate-spin' : ''].join(' ').trim()} style={{ fontSize: '18px' }}>
              {isSaving ? 'sync' : 'save'}
            </span>
            {isSaving ? '保存中' : '保存配置'}
          </button>
        </footer>
      </form>
    </div>
  )
}

function ConfigSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-outline-variant bg-surface-container p-md">
      <div className="mb-sm flex items-center gap-sm">
        <span className="material-symbols-outlined text-secondary" style={{ fontSize: '18px' }}>{icon}</span>
        <h3 className="text-label-lg font-semibold text-on-surface">{title}</h3>
      </div>
      <div className="grid gap-sm">{children}</div>
    </section>
  )
}

function TextField({
  label,
  description,
  value,
  present,
  onChange,
}: {
  label: string
  description: string
  value: string
  present?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
      <div className="flex items-center justify-between gap-md">
        <span className="font-mono text-code-sm text-on-surface-variant">{label}</span>
        {typeof present === 'boolean' ? <StatusPill present={present} /> : null}
      </div>
      <p className="mt-xs text-body-sm text-on-surface-variant">{description}</p>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-sm w-full rounded-md border border-outline-variant bg-surface px-sm py-sm font-mono text-code-sm text-on-surface outline-none focus:border-secondary"
      />
    </label>
  )
}

function SecretField({
  label,
  description,
  value,
  present,
  preview,
  required,
  onChange,
}: {
  label: string
  description: string
  value: string
  present: boolean
  preview?: string | null
  required: boolean
  onChange: (value: string) => void
}) {
  const savedPreview = present && preview ? preview : null
  const placeholder = savedPreview
    ? `已保存 ${savedPreview}；留空不变，输入新值会覆盖`
    : '请输入配置值'

  return (
    <label className="block rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
      <div className="flex items-center justify-between gap-md">
        <span className="font-mono text-code-sm text-on-surface-variant">{label}</span>
        <StatusPill present={present} hasPreview={Boolean(savedPreview)} />
      </div>
      <p className="mt-xs text-body-sm text-on-surface-variant">{description}</p>
      {savedPreview ? (
        <div className="mt-sm rounded-md border border-tertiary/30 bg-tertiary/10 px-sm py-xs">
          <div className="font-mono text-code-sm text-tertiary">当前保存：{savedPreview}</div>
          <p className="mt-xxs text-body-sm text-on-surface-variant">为了避免泄露密钥，完整内容不会回显；保持输入框为空会继续使用当前保存值。</p>
        </div>
      ) : null}
      <input
        type="password"
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-sm w-full rounded-md border border-outline-variant bg-surface px-sm py-sm font-mono text-code-sm text-on-surface outline-none focus:border-secondary"
      />
    </label>
  )
}

function StatusPill({ present, hasPreview = false }: { present: boolean; hasPreview?: boolean }) {
  return (
    <span className={['rounded-full border px-sm py-xs font-mono text-[10px] uppercase', present ? 'border-tertiary/30 bg-tertiary/10 text-tertiary' : 'border-error/30 bg-error/10 text-error'].join(' ')}>
      {present ? (hasPreview ? '已保存密钥' : '已保存') : '未配置'}
    </span>
  )
}

function CommandBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-outline-variant bg-surface px-sm py-xs">
      <div className="text-label-sm text-on-surface-variant">{label}</div>
      <code className="mt-xs block break-all font-mono text-code-sm text-on-surface">{value}</code>
    </div>
  )
}
