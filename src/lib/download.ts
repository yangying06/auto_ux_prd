type TauriSaveResult = 'saved' | 'cancelled' | 'unavailable'

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function tryTauriSave(filename: string, content: string): Promise<TauriSaveResult> {
  if (!isTauriRuntime()) return 'unavailable'

  const [{ save }, { writeTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])

  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })

  if (!path) return 'cancelled'
  await writeTextFile(path, content)
  return 'saved'
}

function browserDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function downloadMarkdown(filename: string, content: string) {
  const tauriResult = await tryTauriSave(filename, content)
  if (tauriResult === 'saved' || tauriResult === 'cancelled') return
  browserDownload(filename, content)
}
