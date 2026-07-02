import type { AppSettings } from '../types/chat'

const localProxyBaseUrl = 'http://127.0.0.1:8787'
const devPorts = new Set(['5173', '5174', '5175', '4173'])

interface RuntimeWindow {
  __TAURI_INTERNALS__?: unknown
  location: {
    protocol: string
    hostname: string
    port: string
    origin: string
  }
}

function runtimeWindow() {
  return (globalThis as { window?: RuntimeWindow }).window
}

function isTauriRuntime() {
  const currentWindow = runtimeWindow()
  return Boolean(currentWindow && '__TAURI_INTERNALS__' in currentWindow)
}

export function resolveDefaultProxyBaseUrl() {
  const currentWindow = runtimeWindow()
  if (!currentWindow || isTauriRuntime()) return localProxyBaseUrl

  const { protocol, hostname, port, origin } = currentWindow.location
  const isHttp = protocol === 'http:' || protocol === 'https:'
  const isLocalHost = hostname === '127.0.0.1' || hostname === 'localhost'
  if (isHttp && isLocalHost && !devPorts.has(port)) return origin

  return localProxyBaseUrl
}

export const defaultSettings: AppSettings = {
  projectName: 'UX SpecForge',
  proxyBaseUrl: resolveDefaultProxyBaseUrl(),
  defaultRagQuery: '当前节点的触发条件、接口字段和目标平台约束',
}
