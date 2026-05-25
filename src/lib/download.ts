import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

export async function downloadMarkdown(filename: string, content: string) {
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (!path) return
  await writeTextFile(path, content)
}
