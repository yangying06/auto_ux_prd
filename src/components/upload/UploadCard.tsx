import { useRef, useState } from 'react'
import { importLarkDocument, type LarkImportResponse } from '../../lib/api'
import type { SourceImageInput } from '../../types/chat'
import type { ProjectWorkflowMode } from '../../types/projectWorkflow'

type ImportSourceFileKind = 'document' | 'code' | 'config' | 'text'

export interface ImportSourceFileInput {
  path: string
  name: string
  size: number
  chars: number
  kind: ImportSourceFileKind
  truncated: boolean
}

interface SelectedSourceFile extends ImportSourceFileInput {
  text: string
}

export interface ImportSourceInput {
  mdText?: string | null
  mdFilename?: string | null
  sourceText?: string | null
  sourceFilename?: string | null
  sourceFiles?: ImportSourceFileInput[]
  sourceImages?: SourceImageInput[]
  figmaUrl?: string | null
}

interface UploadCardProps {
  onImportSources: (sources: ImportSourceInput) => void
  onOpenArchive?: () => void
  onConfigureEnvironment: () => void
  proxyBaseUrl: string
  error?: string | null
  workflowMode: ProjectWorkflowMode
  iterationCodebasePath: string
  iterationFocus: string
  onWorkflowModeChange: (mode: ProjectWorkflowMode) => void
  onIterationCodebasePathChange: (path: string) => void
  onIterationFocusChange: (focus: string) => void
}

const MAX_SOURCE_FILES = 180
const MAX_SOURCE_FILE_BYTES = 220_000
const MAX_CHARS_PER_FILE = 12_000
const MAX_TOTAL_SOURCE_CHARS = 260_000

const SOURCE_EXTENSIONS = new Set([
  '.asmdef',
  '.asset',
  '.c',
  '.cc',
  '.cfg',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.fire',
  '.go',
  '.gradle',
  '.graphql',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.kt',
  '.less',
  '.lua',
  '.md',
  '.mdx',
  '.prefab',
  '.proto',
  '.py',
  '.rb',
  '.rs',
  '.scene',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.unity',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
])

const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.apk',
  '.avi',
  '.bin',
  '.bmp',
  '.class',
  '.dll',
  '.doc',
  '.docx',
  '.dylib',
  '.exe',
  '.gif',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.lock',
  '.mov',
  '.mp3',
  '.mp4',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.psd',
  '.rar',
  '.so',
  '.ttf',
  '.wasm',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsx',
  '.zip',
])

const IGNORED_PATH_SEGMENTS = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.tauri',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'library',
  'logs',
  'node_modules',
  'target',
  'temp',
  'tmp',
])

const FILE_ACCEPT = Array.from(SOURCE_EXTENSIONS).join(',')

function normalizePath(file: File) {
  return (file.webkitRelativePath || file.name).replace(/\\/g, '/')
}

function fileExtension(path: string) {
  const last = path.split('/').pop() ?? path
  const dotIndex = last.lastIndexOf('.')
  return dotIndex >= 0 ? last.slice(dotIndex).toLowerCase() : ''
}

function shouldIgnorePath(path: string) {
  return path
    .split('/')
    .some((segment) => IGNORED_PATH_SEGMENTS.has(segment.toLowerCase()))
}

function isReadableSourceFile(file: File) {
  const path = normalizePath(file)
  if (!path || shouldIgnorePath(path)) return false
  const extension = fileExtension(path)
  if (BINARY_EXTENSIONS.has(extension)) return false
  if (SOURCE_EXTENSIONS.has(extension)) return true
  return file.type.startsWith('text/')
}

function sourceKindForPath(path: string): ImportSourceFileKind {
  const extension = fileExtension(path)
  if (extension === '.md' || extension === '.mdx' || extension === '.txt') return 'document'
  if (extension === '.json' || extension === '.jsonc' || extension === '.yaml' || extension === '.yml' || extension === '.toml' || extension === '.ini' || extension === '.cfg') return 'config'
  if (SOURCE_EXTENSIONS.has(extension)) return 'code'
  return 'text'
}

function languageForPath(path: string) {
  const extension = fileExtension(path).replace('.', '')
  if (!extension) return 'text'
  if (extension === 'tsx' || extension === 'jsx') return extension
  if (extension === 'jsonc') return 'json'
  if (extension === 'mdx') return 'md'
  return extension.replace(/[^a-z0-9_-]/giu, '') || 'text'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function looksBinary(text: string) {
  if (!text) return false
  const sample = text.slice(0, 4096)
  const nulCount = sample.match(/\u0000/gu)?.length ?? 0
  return nulCount > 0
}

function uniqueRootCount(files: Array<{ path: string }>) {
  const roots = new Set(
    files
      .map((file) => file.path.includes('/') ? file.path.split('/')[0] : '')
      .filter(Boolean),
  )
  return roots.size
}

function buildSourceFilename(files: Array<{ path: string; name: string }>) {
  if (files.length === 1) return files[0].name
  const rootCount = uniqueRootCount(files)
  if (rootCount > 0) return `source-corpus-${rootCount}-dirs-${files.length}-files.md`
  return `source-corpus-${files.length}-files.md`
}

function buildSourceCorpus(files: SelectedSourceFile[]) {
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path))
  if (!sortedFiles.length) {
    return {
      text: '',
      filename: 'source-corpus.md',
      files: [],
      warnings: [],
    }
  }

  const warnings: string[] = []
  const sections: string[] = []
  const includedFiles: SelectedSourceFile[] = []
  let remainingChars = MAX_TOTAL_SOURCE_CHARS

  sections.push([
    '# 导入素材索引',
    '',
    `- 可分析文件数：${sortedFiles.length}`,
    `- 目录数：${uniqueRootCount(sortedFiles)}`,
    `- 单文件读取上限：${formatBytes(MAX_SOURCE_FILE_BYTES)} / ${MAX_CHARS_PER_FILE.toLocaleString()} 字符`,
    `- 总上下文上限：${MAX_TOTAL_SOURCE_CHARS.toLocaleString()} 字符`,
  ].join('\n'))

  for (const file of sortedFiles) {
    if (remainingChars <= 0) break
    const header = [
      `## 文件：${file.path}`,
      '',
      `- 类型：${file.kind}`,
      `- 大小：${formatBytes(file.size)}`,
      file.truncated ? '- 读取：已截断' : '- 读取：完整',
      '',
      `\`\`\`\`${languageForPath(file.path)}`,
    ].join('\n')
    const footer = '\n````'
    const bodyBudget = Math.max(0, remainingChars - header.length - footer.length - 32)
    if (bodyBudget <= 0) break
    const body = file.text.slice(0, bodyBudget)
    sections.push(`${header}\n${body}${footer}`)
    includedFiles.push({
      ...file,
      chars: body.length,
      truncated: file.truncated || body.length < file.text.length,
    })
    remainingChars -= header.length + body.length + footer.length
  }

  if (includedFiles.length < sortedFiles.length) {
    warnings.push(`素材总量较大，已纳入前 ${includedFiles.length} 个文件，其余 ${sortedFiles.length - includedFiles.length} 个文件未进入本次 AI 上下文。`)
  }

  const truncatedCount = includedFiles.filter((file) => file.truncated).length
  if (truncatedCount > 0) {
    warnings.push(`${truncatedCount} 个文件因体积较大被截断读取。`)
  }

  return {
    text: sections.join('\n\n---\n\n'),
    filename: buildSourceFilename(includedFiles),
    files: includedFiles.map((file) => ({
      path: file.path,
      name: file.name,
      size: file.size,
      chars: file.chars,
      kind: file.kind,
      truncated: file.truncated,
    })),
    warnings,
  }
}

function mergeSourceFileList(files: SelectedSourceFile[], file: SelectedSourceFile) {
  const byPath = new Map(files.map((item) => [item.path, item]))
  byPath.set(file.path, file)
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))
}

function replaceLarkSourceFileList(files: SelectedSourceFile[], file: SelectedSourceFile) {
  return mergeSourceFileList(files.filter((item) => !item.path.startsWith('feishu/')), file)
}

function mergeSourceImageList(current: SourceImageInput[], images: SourceImageInput[]) {
  if (!images.length) return current
  const byKey = new Map(current.map((image) => [image.sourceUrl || image.token || image.name, image]))
  images.forEach((image) => byKey.set(image.sourceUrl || image.token || image.name, image))
  return Array.from(byKey.values())
}

function sourceFileFromLarkImport(result: LarkImportResponse): SelectedSourceFile {
  return {
    path: `feishu/${result.filename}`,
    name: result.filename,
    text: result.text,
    size: new Blob([result.text]).size,
    chars: result.text.length,
    kind: 'document',
    truncated: false,
  }
}

async function readSourceFiles(fileList: File[]) {
  const warnings: string[] = []
  const readableFiles = fileList.filter(isReadableSourceFile)

  if (readableFiles.length !== fileList.length) {
    warnings.push(`已跳过 ${fileList.length - readableFiles.length} 个二进制、生成物或暂不支持的文件。`)
  }

  const cappedFiles = readableFiles.slice(0, MAX_SOURCE_FILES)
  if (readableFiles.length > cappedFiles.length) {
    warnings.push(`本次最多读取 ${MAX_SOURCE_FILES} 个文本文件，已跳过其余 ${readableFiles.length - cappedFiles.length} 个。`)
  }

  const files: SelectedSourceFile[] = []
  for (const file of cappedFiles) {
    const path = normalizePath(file)
    try {
      const rawText = await file.slice(0, MAX_SOURCE_FILE_BYTES).text()
      if (looksBinary(rawText)) {
        warnings.push(`已跳过疑似二进制文件：${path}`)
        continue
      }
      const normalizedText = rawText.replace(/\r\n/g, '\n').replace(/\u0000/gu, '').trim()
      if (!normalizedText) continue
      const text = normalizedText.slice(0, MAX_CHARS_PER_FILE)
      files.push({
        path,
        name: file.name,
        text,
        size: file.size,
        chars: text.length,
        kind: sourceKindForPath(path),
        truncated: file.size > MAX_SOURCE_FILE_BYTES || normalizedText.length > text.length,
      })
    } catch {
      warnings.push(`读取失败，已跳过：${path}`)
    }
  }

  return { files, warnings }
}

export function UploadCard({
  onImportSources,
  onOpenArchive,
  onConfigureEnvironment,
  proxyBaseUrl,
  error,
  workflowMode,
  iterationCodebasePath,
  iterationFocus,
  onWorkflowModeChange,
  onIterationCodebasePathChange,
  onIterationFocusChange,
}: UploadCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const directoryInputRef = useRef<HTMLInputElement>(null)
  const [isReading, setIsReading] = useState(false)
  const [isFetchingLark, setIsFetchingLark] = useState(false)
  const [rejectionError, setRejectionError] = useState<string | null>(null)
  const [sourceFiles, setSourceFiles] = useState<SelectedSourceFile[]>([])
  const [sourceImages, setSourceImages] = useState<SourceImageInput[]>([])
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([])
  const [figmaUrl, setFigmaUrl] = useState('')
  const [larkUrl, setLarkUrl] = useState('')
  const [larkTitle, setLarkTitle] = useState<string | null>(null)
  const [loadedLarkUrl, setLoadedLarkUrl] = useState<string | null>(null)

  const normalizedFigmaUrl = figmaUrl.trim()
  const normalizedLarkUrl = larkUrl.trim()
  const hasPendingLarkDocument = Boolean(normalizedLarkUrl && normalizedLarkUrl !== loadedLarkUrl)
  const sourceCorpus = buildSourceCorpus(sourceFiles)
  const displayWarnings = [
    ...sourceWarnings,
    ...(sourceImages.length ? [`已读取 ${sourceImages.length} 张飞书图片作为视觉证据。`] : []),
    ...sourceCorpus.warnings,
  ]
  const displayError = error ?? rejectionError
  const isBusy = isReading || isFetchingLark
  const canImport = Boolean(sourceCorpus.text.trim() || normalizedFigmaUrl || normalizedLarkUrl)
  const displayedFiles = sourceFiles.slice(0, 5)
  const sourceTotalBytes = sourceFiles.reduce((total, file) => total + file.size, 0)

  const mergeSourceImages = (images: SourceImageInput[]) => {
    setSourceImages((current) => mergeSourceImageList(current, images))
  }

  const mergeSelectedFiles = async (selectedFiles: File[]) => {
    if (!selectedFiles.length) return
    setIsReading(true)
    setRejectionError(null)
    try {
      const result = await readSourceFiles(selectedFiles)
      if (!result.files.length) {
        setSourceWarnings(result.warnings)
        setRejectionError('没有读取到可分析的文本文件，请选择代码、Markdown、TXT、JSON 等文本素材。')
        return
      }
      setSourceFiles((current) => {
        const byPath = new Map(current.map((file) => [file.path, file]))
        result.files.forEach((file) => byPath.set(file.path, file))
        return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))
      })
      setSourceWarnings(result.warnings)
    } finally {
      setIsReading(false)
    }
  }

  const fetchAndMergeLarkDocument = async (url: string) => {
    const result = await importLarkDocument(proxyBaseUrl, url)
    const file = sourceFileFromLarkImport(result)
    setSourceFiles((current) => replaceLarkSourceFileList(current, file))
    mergeSourceImages(result.images)
    setSourceWarnings(result.warnings)
    setLarkTitle(result.title)
    setLoadedLarkUrl(url)
    return { file, images: result.images }
  }

  const handleFetchLarkDocument = async () => {
    if (!normalizedLarkUrl) {
      setRejectionError('请先粘贴飞书文档链接。')
      return
    }

    setIsFetchingLark(true)
    setRejectionError(null)
    try {
      await fetchAndMergeLarkDocument(normalizedLarkUrl)
    } catch (fetchError) {
      setRejectionError(fetchError instanceof Error ? `飞书读取失败：${fetchError.message}` : '飞书读取失败')
    } finally {
      setIsFetchingLark(false)
    }
  }

  const openDirectoryPicker = () => {
    const input = directoryInputRef.current
    if (!input) return
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.click()
  }

  const handleImport = async () => {
    if (isBusy) return
    if (!canImport) {
      setRejectionError('请至少提供 Figma 链接、飞书 PRD 链接，或导入一个可分析的素材目录/文件。')
      return
    }
    if (normalizedFigmaUrl && !/https?:\/\/(?:www\.)?figma\.com\//iu.test(normalizedFigmaUrl)) {
      setRejectionError('Figma 链接格式不正确，请粘贴 figma.com/design 或 figma.com/file 链接。')
      return
    }
    setRejectionError(null)

    let importSourceFiles = sourceFiles
    let importSourceImages = sourceImages
    if (hasPendingLarkDocument && normalizedLarkUrl) {
      setIsFetchingLark(true)
      try {
        const result = await fetchAndMergeLarkDocument(normalizedLarkUrl)
        importSourceFiles = replaceLarkSourceFileList(importSourceFiles, result.file)
        importSourceImages = mergeSourceImageList(importSourceImages, result.images)
      } catch (fetchError) {
        setRejectionError(fetchError instanceof Error ? `飞书读取失败：${fetchError.message}` : '飞书读取失败')
        return
      } finally {
        setIsFetchingLark(false)
      }
    }

    const importSourceCorpus = buildSourceCorpus(importSourceFiles)
    if (!importSourceCorpus.text.trim() && !normalizedFigmaUrl) {
      setRejectionError('没有读取到可分析的 PRD 正文，请检查飞书链接权限或重新读取。')
      return
    }

    onImportSources({
      sourceText: importSourceCorpus.text,
      sourceFilename: importSourceCorpus.filename,
      sourceFiles: importSourceCorpus.files,
      sourceImages: importSourceImages,
      mdText: importSourceCorpus.text,
      mdFilename: importSourceCorpus.filename,
      figmaUrl: normalizedFigmaUrl || null,
    })
  }

  return (
    <>
      <span className="material-symbols-outlined text-on-surface" style={{ fontSize: '32px' }}>account_tree</span>
      <h1 className="text-headline-sm font-semibold text-on-surface">GameUX PromptForge</h1>
      <p className="text-label-md font-semibold text-on-surface-variant uppercase tracking-wider">PRD 拆解引擎</p>
      <button
        type="button"
        onClick={onConfigureEnvironment}
        className="flex min-h-[36px] items-center gap-2 rounded-lg border border-outline-variant bg-surface px-3 py-2 text-label-md text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>settings</span>
        环境配置
      </button>

      <div className="grid w-full grid-cols-2 gap-xs rounded-lg border border-outline-variant bg-surface-container p-xs">
        {[
          { id: 'new_project' as const, label: '新项目拆解', icon: 'note_add' },
          { id: 'existing_project_iteration' as const, label: '已有项目迭代', icon: 'difference' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onWorkflowModeChange(item.id)}
            aria-pressed={workflowMode === item.id}
            className={[
              'flex min-h-[40px] items-center justify-center gap-xs rounded-md px-sm py-xs text-label-md transition-colors',
              workflowMode === item.id
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            ].join(' ')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {workflowMode === 'existing_project_iteration' ? (
        <div className="grid w-full gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <label className="grid gap-xs">
            <span className="text-label-md text-on-surface">代码库路径</span>
            <input
              value={iterationCodebasePath}
              onChange={(event) => onIterationCodebasePathChange(event.target.value)}
              className="min-h-[40px] rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface outline-none focus:border-secondary"
              placeholder="D:\\project\\client"
            />
          </label>
          <label className="grid gap-xs">
            <span className="text-label-md text-on-surface">本次迭代焦点</span>
            <textarea
              value={iterationFocus}
              onChange={(event) => onIterationFocusChange(event.target.value)}
              className="min-h-[72px] resize-none rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface outline-none focus:border-secondary"
              placeholder="例如：帮助界面的任务说明功能"
            />
          </label>
        </div>
      ) : null}

      <label className="grid w-full gap-xs">
        <span className="text-label-md text-on-surface">Figma 设计稿链接</span>
        <input
          value={figmaUrl}
          onChange={(event) => setFigmaUrl(event.target.value)}
          className="min-h-[42px] rounded-lg border border-outline-variant bg-surface px-md py-sm text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-secondary"
          placeholder="https://www.figma.com/design/...?...node-id=..."
        />
        <span className="text-code-sm text-on-surface-variant">
          有 Figma 时优先按设计稿解析；导入素材会补充功能规则、代码约束、文案和验收信息。
        </span>
      </label>

      <section className="grid w-full gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md">
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '20px' }}>article</span>
              <h2 className="text-label-lg font-semibold text-on-surface">飞书 PRD 链接</h2>
            </div>
            <p className="mt-[2px] text-body-md text-on-surface-variant">
              {larkTitle && !hasPendingLarkDocument ? `已读取：${larkTitle}` : hasPendingLarkDocument ? '待读取：开始解析前会自动拉取 PRD 正文。' : '读取飞书文档正文，并尽量带入文档图片。'}
            </p>
          </div>
          <button
            type="button"
            onClick={onConfigureEnvironment}
            className="shrink-0 rounded border border-outline-variant bg-surface px-sm py-xs text-code-sm text-on-surface-variant transition-colors hover:bg-surface-variant"
          >
            配置
          </button>
        </div>
        <div className="grid gap-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={larkUrl}
            onChange={(event) => setLarkUrl(event.target.value)}
            className="min-h-[42px] min-w-0 rounded-lg border border-outline-variant bg-surface px-md py-sm text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-secondary"
            placeholder="https://xxx.feishu.cn/docx/... 或 wiki 链接"
          />
          <button
            type="button"
            onClick={() => { void handleFetchLarkDocument() }}
            disabled={!normalizedLarkUrl || isFetchingLark}
            className={[
              'flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-label-md transition-colors',
              normalizedLarkUrl && !isFetchingLark
                ? 'border border-tertiary/40 bg-tertiary/10 text-tertiary hover:bg-tertiary/20'
                : 'cursor-not-allowed border border-outline-variant bg-surface-container text-on-surface-variant opacity-60',
            ].join(' ')}
          >
            <span className={['material-symbols-outlined', isFetchingLark ? 'animate-spin' : ''].join(' ').trim()} style={{ fontSize: '18px' }}>
              {isFetchingLark ? 'sync' : 'cloud_download'}
            </span>
            {isFetchingLark ? '读取中...' : '读取飞书'}
          </button>
        </div>
      </section>

      <section className="w-full rounded-lg border border-outline-variant bg-surface-container-low p-md">
        <header className="flex items-start justify-between gap-md border-b border-outline-variant/70 pb-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '20px' }}>inventory_2</span>
              <h2 className="text-label-lg font-semibold text-on-surface">素材池</h2>
            </div>
            <p className="mt-[2px] text-body-md text-on-surface-variant">
              {isReading ? '正在读取素材...' : sourceFiles.length ? '文件会合并为本次分析资料' : '通过下方按钮添加文件或文件夹'}
            </p>
          </div>
          {sourceFiles.length ? (
            <div className="flex shrink-0 items-center gap-xs">
              <span className="rounded border border-outline-variant bg-surface px-sm py-xs text-code-sm text-on-surface-variant">{sourceFiles.length} 文件</span>
              <span className="rounded border border-outline-variant bg-surface px-sm py-xs text-code-sm text-on-surface-variant">{formatBytes(sourceTotalBytes)}</span>
            </div>
          ) : null}
        </header>

        <div className="mt-sm flex flex-wrap gap-sm">
          <button
            type="button"
            className="flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 text-label-md text-on-surface transition-colors hover:bg-surface-variant"
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
            添加文件
          </button>
          <button
            type="button"
            className="flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 text-label-md text-on-surface transition-colors hover:bg-surface-variant"
            onClick={openDirectoryPicker}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>create_new_folder</span>
            添加文件夹
          </button>
          {sourceFiles.length ? (
            <button
              type="button"
              className="flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface px-3 py-2 text-label-md text-on-surface-variant transition-colors hover:bg-surface-variant"
              onClick={() => {
                setSourceFiles([])
                setSourceImages([])
                setSourceWarnings([])
                setLarkTitle(null)
                setLoadedLarkUrl(null)
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
              清空
            </button>
          ) : null}
        </div>

        {sourceFiles.length ? (
          <div className="mt-sm grid w-full gap-xs text-left">
            {displayedFiles.map((file) => (
              <div key={file.path} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-sm rounded border border-outline-variant/70 bg-surface px-sm py-xs">
                <span className="min-w-0 truncate text-body-md font-medium text-on-surface">{file.path}</span>
                <span className="shrink-0 text-code-sm text-on-surface-variant">{formatBytes(file.size)}</span>
              </div>
            ))}
            {sourceFiles.length > displayedFiles.length ? (
              <p className="px-xs text-code-sm text-on-surface-variant">还有 {sourceFiles.length - displayedFiles.length} 个文件已纳入素材池。</p>
            ) : null}
          </div>
        ) : (
          <div className="mt-sm rounded border border-dashed border-outline-variant bg-surface/40 px-md py-sm text-body-md text-on-surface-variant">
            尚未添加素材。可以添加多个文件，也可以多次添加不同文件夹。
          </div>
        )}
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          void mergeSelectedFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <input
        ref={directoryInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          void mergeSelectedFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />

      <div className="flex flex-wrap items-center justify-center gap-sm">
        <button
          type="button"
          className={[
            'flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-label-md transition-colors',
            canImport && !isBusy
              ? 'border border-secondary-container bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80'
              : 'cursor-not-allowed border border-outline-variant bg-surface-container text-on-surface-variant opacity-60',
          ].join(' ')}
          disabled={!canImport || isBusy}
          onClick={() => { void handleImport() }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>account_tree</span>
          {hasPendingLarkDocument ? '读取并解析资料' : '开始解析资料'}
        </button>
        {onOpenArchive ? (
          <button
            type="button"
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-secondary/40 bg-secondary/10 px-4 py-2 text-label-md text-secondary transition-colors hover:bg-secondary/20"
            onClick={onOpenArchive}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>folder_open</span>
            打开存档
          </button>
        ) : null}
      </div>

      {displayWarnings.length ? (
        <div className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2 text-body-md text-on-surface-variant">
          {displayWarnings.slice(0, 3).map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {displayError ? (
        <div className="flex w-full items-start gap-2 rounded-lg border border-error-container bg-error-container/10 px-4 py-2">
          <span className="material-symbols-outlined flex-shrink-0 text-error" style={{ fontSize: '18px' }}>error_outline</span>
          <div>
            <p className="text-body-lg text-error">导入失败</p>
            <p className="text-body-md text-on-surface-variant">{displayError}</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
