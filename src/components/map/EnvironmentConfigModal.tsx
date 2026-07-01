import { useEffect, useState, type FormEvent } from 'react'
import { saveAiEnvironmentConfig } from '../../lib/api'
import type { AiEnvironmentConfig } from '../../types/chat'

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
  const [larkCliBin, setLarkCliBin] = useState('lark-cli')
  const [larkIdentity, setLarkIdentity] = useState('user')
  const [larkAppId, setLarkAppId] = useState('')
  const [larkAppIdTouched, setLarkAppIdTouched] = useState(false)
  const [larkAppSecret, setLarkAppSecret] = useState('')
  const [larkAppSecretTouched, setLarkAppSecretTouched] = useState(false)
  const [larkTenantAccessToken, setLarkTenantAccessToken] = useState('')
  const [larkTenantAccessTokenTouched, setLarkTenantAccessTokenTouched] = useState(false)
  const [larkUserAccessToken, setLarkUserAccessToken] = useState('')
  const [larkUserAccessTokenTouched, setLarkUserAccessTokenTouched] = useState(false)
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
    setLarkCliBin(status?.values.LARK_CLI_BIN || 'lark-cli')
    setLarkIdentity(status?.values.LARK_IDENTITY || 'user')
    setLarkAppId('')
    setLarkAppIdTouched(false)
    setLarkAppSecret('')
    setLarkAppSecretTouched(false)
    setLarkTenantAccessToken('')
    setLarkTenantAccessTokenTouched(false)
    setLarkUserAccessToken('')
    setLarkUserAccessTokenTouched(false)
    setError(null)
  }, [open, status])

  if (!open) return null

  const apiKeyMissing = !status?.values.ANTHROPIC_API_KEY_PRESENT
  const figmaMissing = !status?.values.FIGMA_TOKEN_PRESENT
  const larkAppIdMissing = !status?.values.LARK_APP_ID_PRESENT
  const larkAppSecretMissing = !status?.values.LARK_APP_SECRET_PRESENT
  const larkTenantTokenMissing = !status?.values.LARK_TENANT_ACCESS_TOKEN_PRESENT
  const larkUserTokenMissing = !status?.values.LARK_USER_ACCESS_TOKEN_PRESENT

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      const payload = {
        ANTHROPIC_BASE_URL: anthropicBaseUrl,
        CLAUDE_MODEL: claudeModel,
        MOCK_DECOMPOSE: mockDecompose,
        LARK_CLI_BIN: larkCliBin,
        LARK_IDENTITY: larkIdentity,
        ...(anthropicApiKeyTouched || apiKeyMissing ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
        ...(figmaTokenTouched || figmaMissing ? { FIGMA_TOKEN: figmaToken } : {}),
        ...(larkAppIdTouched || larkAppIdMissing ? { LARK_APP_ID: larkAppId } : {}),
        ...(larkAppSecretTouched || larkAppSecretMissing ? { LARK_APP_SECRET: larkAppSecret } : {}),
        ...(larkTenantAccessTokenTouched || larkTenantTokenMissing ? { LARK_TENANT_ACCESS_TOKEN: larkTenantAccessToken } : {}),
        ...(larkUserAccessTokenTouched || larkUserTokenMissing ? { LARK_USER_ACCESS_TOKEN: larkUserAccessToken } : {}),
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
        className="flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-md border-b border-outline-variant bg-surface-container-low px-lg py-md">
          <div>
            <div className="font-mono text-label-md uppercase text-secondary">ENV</div>
            <h2 className="mt-xs text-headline-sm font-semibold text-on-surface">配置环境</h2>
          </div>
          {!required ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:text-on-surface"
              aria-label="关闭配置环境"
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
            <SecretField
              label="ANTHROPIC_API_KEY"
              value={anthropicApiKey}
              present={!apiKeyMissing}
              required={apiKeyMissing}
              onChange={(value) => {
                setAnthropicApiKey(value)
                setAnthropicApiKeyTouched(true)
              }}
            />
            <TextField label="ANTHROPIC_BASE_URL" value={anthropicBaseUrl} onChange={setAnthropicBaseUrl} />
            <TextField label="CLAUDE_MODEL" value={claudeModel} onChange={setClaudeModel} />
            <label className="flex items-center justify-between gap-md rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
              <span className="font-mono text-code-sm text-on-surface">MOCK_DECOMPOSE</span>
              <input
                type="checkbox"
                checked={mockDecompose}
                onChange={(event) => setMockDecompose(event.target.checked)}
                className="h-5 w-5 accent-secondary"
              />
            </label>
            <SecretField
              label="FIGMA_TOKEN"
              value={figmaToken}
              present={!figmaMissing}
              required={false}
              onChange={(value) => {
                setFigmaToken(value)
                setFigmaTokenTouched(true)
              }}
            />
            <div className="rounded-lg border border-outline-variant bg-surface-container px-md py-sm">
              <div className="font-mono text-code-sm uppercase text-secondary">LARK / FEISHU</div>
              <p className="mt-xs text-body-sm text-on-surface-variant">
                飞书文档导入优先复用本机 lark-cli；需要用户态文档权限时，请先完成 lark-cli 授权或填入可用 token。
              </p>
            </div>
            <TextField label="LARK_CLI_BIN" value={larkCliBin} onChange={setLarkCliBin} />
            <TextField label="LARK_IDENTITY" value={larkIdentity} onChange={setLarkIdentity} />
            <SecretField
              label="LARK_APP_ID"
              value={larkAppId}
              present={!larkAppIdMissing}
              required={false}
              onChange={(value) => {
                setLarkAppId(value)
                setLarkAppIdTouched(true)
              }}
            />
            <SecretField
              label="LARK_APP_SECRET"
              value={larkAppSecret}
              present={!larkAppSecretMissing}
              required={false}
              onChange={(value) => {
                setLarkAppSecret(value)
                setLarkAppSecretTouched(true)
              }}
            />
            <SecretField
              label="LARK_TENANT_ACCESS_TOKEN"
              value={larkTenantAccessToken}
              present={!larkTenantTokenMissing}
              required={false}
              onChange={(value) => {
                setLarkTenantAccessToken(value)
                setLarkTenantAccessTokenTouched(true)
              }}
            />
            <SecretField
              label="LARK_USER_ACCESS_TOKEN"
              value={larkUserAccessToken}
              present={!larkUserTokenMissing}
              required={false}
              onChange={(value) => {
                setLarkUserAccessToken(value)
                setLarkUserAccessTokenTouched(true)
              }}
            />
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
            {isSaving ? '保存中' : '保存'}
          </button>
        </footer>
      </form>
    </div>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
      <div className="font-mono text-code-sm text-on-surface-variant">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-xs w-full rounded-md border border-outline-variant bg-surface px-sm py-sm font-mono text-code-sm text-on-surface outline-none focus:border-secondary"
      />
    </label>
  )
}

function SecretField({
  label,
  value,
  present,
  required,
  onChange,
}: {
  label: string
  value: string
  present: boolean
  required: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
      <div className="flex items-center justify-between gap-md">
        <span className="font-mono text-code-sm text-on-surface-variant">{label}</span>
        <span className={['rounded-full border px-sm py-xs font-mono text-[10px] uppercase', present ? 'border-tertiary/30 bg-tertiary/10 text-tertiary' : 'border-error/30 bg-error/10 text-error'].join(' ')}>
          {present ? '已配置' : '未配置'}
        </span>
      </div>
      <input
        type="password"
        value={value}
        required={required}
        placeholder={present ? '留空保持不变' : ''}
        onChange={(event) => onChange(event.target.value)}
        className="mt-xs w-full rounded-md border border-outline-variant bg-surface px-sm py-sm font-mono text-code-sm text-on-surface outline-none focus:border-secondary"
      />
    </label>
  )
}
