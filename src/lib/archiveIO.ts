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
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])

    if (input.currentPath && !input.saveAs) {
      await writeFile(input.currentPath, input.bytes)
      return { status: 'saved', path: input.currentPath }
    }

    const path = await save({
      defaultPath,
      filters: [{ name: 'PromptForge Project', extensions: [PROJECT_ARCHIVE_EXTENSION] }],
    })
    if (!path) return { status: 'cancelled', path: null }
    await writeFile(path, input.bytes)
    return { status: 'saved', path }
  }

  browserDownload(defaultPath, input.bytes)
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
    picked = path ? { bytes: await readFile(path), path } : null
  } else {
    picked = await browserPickArchiveFile()
  }

  if (!picked) return null
  const archive = decodeProjectArchive(picked.bytes)
  return { ...archive, path: picked.path }
}
