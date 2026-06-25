import {
  PROJECT_ARCHIVE_EXTENSION,
  PROJECT_ARCHIVE_MIME,
  type ProjectArchiveOpenResult,
  type ProjectArchiveSaveResult,
} from '../types/archive'
import { decodeProjectArchive } from './archiveCodec'

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function formatProjectArchiveError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error)

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'error', 'reason', 'detail', 'details']) {
      const value = record[key]
      const message = formatProjectArchiveError(value, '')
      if (message) return message
    }

    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch {
      // Ignore serialization failures and use the caller-provided fallback.
    }
  }

  return fallback
}

function archiveIoError(action: string, error: unknown, path?: string | null) {
  const detail = formatProjectArchiveError(error, '')
  const target = path ? `（${path}）` : ''
  const suffix = detail ? `：${detail}` : ''
  return new Error(`${action}${target}失败${suffix}`)
}

function ensureArchiveFilename(filename: string) {
  const cleaned = filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const fallback = `promptforge-project-${new Date().toISOString().slice(0, 10)}`
  const base = cleaned || fallback
  return base.toLowerCase().endsWith(`.${PROJECT_ARCHIVE_EXTENSION}`) ? base : `${base}.${PROJECT_ARCHIVE_EXTENSION}`
}

function browserDownload(filename: string, bytes: Uint8Array) {
  const blob = new Blob([Uint8Array.from(bytes)], { type: PROJECT_ARCHIVE_MIME })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function browserPickArchiveFile() {
  return new Promise<{ bytes: Uint8Array; path: null } | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.${PROJECT_ARCHIVE_EXTENSION},application/zip,${PROJECT_ARCHIVE_MIME}`
    input.style.display = 'none'

    const cleanup = () => input.remove()

    input.onchange = async () => {
      const file = input.files?.[0]
      cleanup()
      if (!file) {
        resolve(null)
        return
      }
      const buffer = await file.arrayBuffer()
      resolve({ bytes: new Uint8Array(buffer), path: null })
    }
    input.addEventListener('cancel', () => {
      cleanup()
      resolve(null)
    }, { once: true })

    document.body.appendChild(input)
    input.click()
  })
}

export async function saveProjectArchiveBytes(input: {
  bytes: Uint8Array
  defaultFilename: string
  currentPath: string | null
  saveAs?: boolean
}): Promise<ProjectArchiveSaveResult> {
  const defaultPath = ensureArchiveFilename(input.defaultFilename)

  if (isTauriRuntime()) {
    let saveDialog: typeof import('@tauri-apps/plugin-dialog').save
    let writeArchiveFile: typeof import('@tauri-apps/plugin-fs').writeFile
    try {
      const [dialog, fs] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
      ])
      saveDialog = dialog.save
      writeArchiveFile = fs.writeFile
    } catch (error) {
      throw archiveIoError('加载 Tauri 存档插件', error)
    }

    if (input.currentPath && !input.saveAs) {
      try {
        await writeArchiveFile(input.currentPath, input.bytes)
      } catch (error) {
        throw archiveIoError('写入现有项目存档', error, input.currentPath)
      }
      return { status: 'saved', path: input.currentPath }
    }

    let path: string | null
    try {
      path = await saveDialog({
        defaultPath,
        filters: [{ name: 'PromptForge Project', extensions: [PROJECT_ARCHIVE_EXTENSION] }],
      })
    } catch (error) {
      throw archiveIoError('打开项目存档保存对话框', error)
    }

    if (!path) return { status: 'cancelled', path: null }
    try {
      await writeArchiveFile(path, input.bytes)
    } catch (error) {
      throw archiveIoError('写入项目存档', error, path)
    }
    return { status: 'saved', path }
  }

  try {
    browserDownload(defaultPath, input.bytes)
  } catch (error) {
    throw archiveIoError('下载项目存档', error, defaultPath)
  }
  return { status: 'saved', path: null }
}

export async function openProjectArchiveFile(): Promise<ProjectArchiveOpenResult | null> {
  let picked: { bytes: Uint8Array; path: string | null } | null

  if (isTauriRuntime()) {
    const [{ open }, { readFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PromptForge Project', extensions: [PROJECT_ARCHIVE_EXTENSION] }],
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (!path) {
      picked = null
    } else {
      try {
        picked = { bytes: await readFile(path), path }
      } catch (error) {
        throw archiveIoError('读取项目存档', error, path)
      }
    }
  } else {
    picked = await browserPickArchiveFile()
  }

  if (!picked) return null
  const archive = decodeProjectArchive(picked.bytes)
  return { ...archive, path: picked.path }
}
