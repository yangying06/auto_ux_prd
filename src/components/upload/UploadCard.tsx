import { useRef, useState } from 'react'
import { importLarkDocument, type LarkImportResponse } from '../../lib/api'
import type { SourceImageInput } from '../../types/chat'

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
  figmaPrdUrl?: string | null
}

interface UploadCardProps {
  onImportSources: (sources: ImportSourceInput) => void
  onOpenArchive?: () => void
  onConfigureEnvironment: () => void
  proxyBaseUrl: string
  error?: string | null
}

const MAX_SOURCE_FILES = 180
const MAX_GITHUB_SOURCE_FILES = 80
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

interface GithubRepositoryRef {
  owner: string
  repo: string
  branch: string | null
  pathPrefix: string
}

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

function isReadableSourcePath(path: string, mimeType = '') {
  if (!path || shouldIgnorePath(path)) return false
  const extension = fileExtension(path)
  if (BINARY_EXTENSIONS.has(extension)) return false
  if (SOURCE_EXTENSIONS.has(extension)) return true
  return mimeType.startsWith('text/')
}

function isReadableSourceFile(file: File) {
  const path = normalizePath(file)
  return isReadableSourcePath(path, file.type)
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

function mergeSourceFileLists(files: SelectedSourceFile[], incomingFiles: SelectedSourceFile[]) {
  const byPath = new Map(files.map((item) => [item.path, item]))
  incomingFiles.forEach((file) => byPath.set(file.path, file))
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))
}

function mergeSourceFileList(files: SelectedSourceFile[], file: SelectedSourceFile) {
  return mergeSourceFileLists(files, [file])
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

function parseGithubRepositoryUrl(value: string): GithubRepositoryRef | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/iu.exec(trimmed)
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2].replace(/\.git$/iu, ''),
      branch: null,
      pathPrefix: '',
    }
  }

  try {
    const withProtocol = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`
    const parsed = new URL(withProtocol)
    if (parsed.hostname.toLowerCase() !== 'github.com') return null
    const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment))
    if (segments.length < 2) return null
    const [owner, rawRepo] = segments
    const repo = rawRepo.replace(/\.git$/iu, '')
    const treeIndex = segments.findIndex((segment) => segment === 'tree')
    const branch = treeIndex >= 0 && segments[treeIndex + 1] ? segments[treeIndex + 1] : null
    const pathPrefix = treeIndex >= 0 ? segments.slice(treeIndex + 2).join('/') : ''
    return owner && repo ? { owner, repo, branch, pathPrefix } : null
  } catch {
    return null
  }
}

function githubRawFileUrl(ref: GithubRepositoryRef, branch: string, path: string) {
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `https://raw.githubusercontent.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${encodeURIComponent(branch)}/${encodedPath}`
}

async function readGithubRepositorySourceFiles(value: string) {
  const ref = parseGithubRepositoryUrl(value)
  if (!ref) throw new Error('GitHub 项目链接格式不正确。')

  const repoResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`)
  if (!repoResponse.ok) throw new Error(`无法访问仓库：HTTP ${repoResponse.status}`)
  const repoInfo = await repoResponse.json() as { default_branch?: string }
  const branch = ref.branch ?? repoInfo.default_branch ?? 'main'

  const treeResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
  if (!treeResponse.ok) throw new Error(`无法读取仓库文件树：HTTP ${treeResponse.status}`)
  const treeInfo = await treeResponse.json() as {
    tree?: Array<{ path?: string; type?: string; size?: number }>
    truncated?: boolean
  }
  const tree = Array.isArray(treeInfo.tree) ? treeInfo.tree : []
  const prefix = ref.pathPrefix.replace(/^\/+|\/+$/gu, '')
  const candidateEntries = tree
    .filter((entry) => entry.type === 'blob' && entry.path)
    .filter((entry): entry is { path: string; type: string; size?: number } => Boolean(entry.path))
    .filter((entry) => !prefix || entry.path === prefix || entry.path.startsWith(`${prefix}/`))
    .filter((entry) => isReadableSourcePath(entry.path))

  const warnings: string[] = []
  const oversizedCount = candidateEntries.filter((entry) => typeof entry.size === 'number' && entry.size > MAX_SOURCE_FILE_BYTES).length
  const readableEntries = candidateEntries.filter((entry) => typeof entry.size !== 'number' || entry.size <= MAX_SOURCE_FILE_BYTES)
  const cappedEntries = readableEntries.slice(0, MAX_GITHUB_SOURCE_FILES)

  if (treeInfo.truncated) warnings.push('GitHub 文件树已截断，已读取可用部分。')
  if (oversizedCount > 0) warnings.push(`已跳过 ${oversizedCount} 个过大的 GitHub 文件。`)
  if (readableEntries.length > cappedEntries.length) {
    warnings.push(`GitHub 仓库文件较多，已纳入前 ${cappedEntries.length} 个文本文件。`)
  }

  const files: SelectedSourceFile[] = []
  for (const entry of cappedEntries) {
    try {
      const rawResponse = await fetch(githubRawFileUrl(ref, branch, entry.path))
      if (!rawResponse.ok) {
        warnings.push(`GitHub 文件读取失败：${entry.path}`)
        continue
      }
      const rawText = await rawResponse.text()
      if (looksBinary(rawText)) {
        warnings.push(`已跳过疑似二进制文件：${entry.path}`)
        continue
      }
      const normalizedText = rawText.replace(/\r\n/g, '\n').replace(/\u0000/gu, '').trim()
      if (!normalizedText) continue
      const text = normalizedText.slice(0, MAX_CHARS_PER_FILE)
      files.push({
        path: `github/${ref.owner}/${ref.repo}/${entry.path}`,
        name: entry.path.split('/').pop() ?? entry.path,
        text,
        size: entry.size ?? new Blob([rawText]).size,
        chars: text.length,
        kind: sourceKindForPath(entry.path),
        truncated: normalizedText.length > text.length,
      })
    } catch {
      warnings.push(`GitHub 文件读取失败：${entry.path}`)
    }
  }

  if (!files.length) throw new Error('没有读取到可分析的 GitHub 文本文件。')
  return { files, warnings }
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
}: UploadCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const directoryInputRef = useRef<HTMLInputElement>(null)
  const codeRepositoryInputRef = useRef<HTMLInputElement>(null)
  const [isReading, setIsReading] = useState(false)
  const [isFetchingLark, setIsFetchingLark] = useState(false)
  const [isFetchingGithub, setIsFetchingGithub] = useState(false)
  const [rejectionError, setRejectionError] = useState<string | null>(null)
  const [sourceFiles, setSourceFiles] = useState<SelectedSourceFile[]>([])
  const [sourceImages, setSourceImages] = useState<SourceImageInput[]>([])
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([])
  const [figmaUrl, setFigmaUrl] = useState('')
  const [figmaPrdUrl, setFigmaPrdUrl] = useState('')
  const [larkUrl, setLarkUrl] = useState('')
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [larkTitle, setLarkTitle] = useState<string | null>(null)
  const [loadedLarkUrl, setLoadedLarkUrl] = useState<string | null>(null)
  const [loadedGithubRepoUrl, setLoadedGithubRepoUrl] = useState<string | null>(null)

  const normalizedFigmaUrl = figmaUrl.trim()
  const normalizedFigmaPrdUrl = figmaPrdUrl.trim()
  const normalizedLarkUrl = larkUrl.trim()
  const normalizedGithubRepoUrl = githubRepoUrl.trim()
  const hasPendingLarkDocument = Boolean(normalizedLarkUrl && normalizedLarkUrl !== loadedLarkUrl)
  const hasPendingGithubRepository = Boolean(normalizedGithubRepoUrl && normalizedGithubRepoUrl !== loadedGithubRepoUrl)
  const sourceCorpus = buildSourceCorpus(sourceFiles)
  const displayWarnings = [
    ...sourceWarnings,
    ...(sourceImages.length ? [`已读取 ${sourceImages.length} 张飞书图片作为视觉证据。`] : []),
    ...sourceCorpus.warnings,
  ]
  const displayError = error ?? rejectionError
  const isBusy = isReading || isFetchingLark || isFetchingGithub
  const canImport = Boolean(sourceCorpus.text.trim() || normalizedFigmaUrl || normalizedFigmaPrdUrl || normalizedLarkUrl || normalizedGithubRepoUrl)
  const displayedFiles = sourceFiles.slice(0, 5)
  const sourceTotalBytes = sourceFiles.reduce((total, file) => total + file.size, 0)
  const figmaSourceHint = normalizedFigmaUrl
    ? '已作为界面设计证据；正式解析会读取节点树、文案、连线和截图。'
    : '可选：用于补充页面结构、状态、连线和视觉证据。'
  const figmaPrdSourceHint = normalizedFigmaPrdUrl
    ? '已作为 Figma PRD 画布来源；正式解析会读取画布文字和图片块。'
    : '当需求直接写在 Figma 画布上时粘贴这里；飞书 PRD 链接仍然保留在下方。'

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

  const fetchAndMergeGithubRepository = async (url: string) => {
    const result = await readGithubRepositorySourceFiles(url)
    setSourceFiles((current) => mergeSourceFileLists(current, result.files))
    setSourceWarnings(result.warnings)
    setLoadedGithubRepoUrl(url)
    return result
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

  const handleFetchGithubRepository = async () => {
    if (!normalizedGithubRepoUrl) {
      setRejectionError('请先粘贴 GitHub 项目链接。')
      return
    }

    setIsFetchingGithub(true)
    setRejectionError(null)
    try {
      await fetchAndMergeGithubRepository(normalizedGithubRepoUrl)
    } catch (fetchError) {
      setRejectionError(fetchError instanceof Error ? `GitHub 读取失败：${fetchError.message}` : 'GitHub 读取失败')
    } finally {
      setIsFetchingGithub(false)
    }
  }

  const openDirectoryPicker = () => {
    const input = directoryInputRef.current
    if (!input) return
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.click()
  }

  const openCodeRepositoryPicker = () => {
    const input = codeRepositoryInputRef.current
    if (!input) return
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.click()
  }

  const validateFigmaSourceUrl = (url: string, label: string) => {
    if (!url) return true
    if (!/https?:\/\/(?:www\.)?figma\.com\//iu.test(url)) {
      setRejectionError(`${label}格式不正确，请粘贴 figma.com/design、figma.com/file 或 figma.com/proto 链接。`)
      return false
    }
    try {
      const parsedFigmaUrl = new URL(url)
      const hasNodeId = Boolean(parsedFigmaUrl.searchParams.get('node-id') ?? parsedFigmaUrl.searchParams.get('node_id'))
      if (!hasNodeId) {
        setRejectionError(`${label}需要包含 node-id，请在 Figma 中选中具体 Frame、Section 或 PRD 画布节点后复制链接。`)
        return false
      }
    } catch {
      setRejectionError(`${label}格式不正确，请粘贴完整的 figma.com 链接。`)
      return false
    }
    return true
  }

  const handleImport = async () => {
    if (isBusy) return
    if (!canImport) {
      setRejectionError('请至少提供飞书 PRD 链接、Figma PRD 画布链接、Figma 设计稿链接，或导入一个可分析的素材目录/文件。')
      return
    }
    if (!validateFigmaSourceUrl(normalizedFigmaUrl, 'Figma 设计稿链接')) return
    if (!validateFigmaSourceUrl(normalizedFigmaPrdUrl, 'Figma PRD 画布链接')) return
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

    if (hasPendingGithubRepository && normalizedGithubRepoUrl) {
      setIsFetchingGithub(true)
      try {
        const result = await fetchAndMergeGithubRepository(normalizedGithubRepoUrl)
        importSourceFiles = mergeSourceFileLists(importSourceFiles, result.files)
      } catch (fetchError) {
        setRejectionError(fetchError instanceof Error ? `GitHub 读取失败：${fetchError.message}` : 'GitHub 读取失败')
        return
      } finally {
        setIsFetchingGithub(false)
      }
    }

    const importSourceCorpus = buildSourceCorpus(importSourceFiles)
    if (!importSourceCorpus.text.trim() && !normalizedFigmaUrl && !normalizedFigmaPrdUrl) {
      setRejectionError('没有读取到可分析的 PRD 正文，请检查飞书链接、Figma PRD 画布链接权限，或重新读取。')
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
      figmaPrdUrl: normalizedFigmaPrdUrl || null,
    })
  }

  return (
    <>
      <span className="material-symbols-outlined text-on-surface" style={{ fontSize: '32px' }}>account_tree</span>
      <h1 className="text-headline-sm font-semibold text-on-surface">UX SpecForge</h1>
      <p className="text-label-md font-semibold text-on-surface-variant">导入资料，生成交互导图</p>
      <button
        type="button"
        onClick={onConfigureEnvironment}
        className="flex min-h-[36px] items-center gap-2 rounded-lg border border-outline-variant bg-surface px-3 py-2 text-label-md text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>settings</span>
        环境配置
      </button>

      <label className="grid w-full gap-xs">
        <span className="text-label-md text-on-surface">Figma 设计稿链接</span>
        <input
          value={figmaUrl}
          onChange={(event) => setFigmaUrl(event.target.value)}
          className="min-h-[42px] rounded-lg border border-outline-variant bg-surface px-md py-sm text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-secondary"
          placeholder="https://www.figma.com/design/...?...node-id=..."
        />
        <span className="text-code-sm text-on-surface-variant">
          {figmaSourceHint}
        </span>
      </label>

      <label className="grid w-full gap-xs">
        <span className="text-label-md text-on-surface">Figma PRD 画布链接</span>
        <input
          value={figmaPrdUrl}
          onChange={(event) => setFigmaPrdUrl(event.target.value)}
          className="min-h-[42px] rounded-lg border border-outline-variant bg-surface px-md py-sm text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-secondary"
          placeholder="https://www.figma.com/design/...?...node-id=..."
        />
        <span className="text-code-sm text-on-surface-variant">
          {figmaPrdSourceHint}
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
              {larkTitle && !hasPendingLarkDocument ? `已读取：${larkTitle}` : hasPendingLarkDocument ? '开始解析前会自动读取。' : '粘贴 PRD 文档链接。'}
            </p>
          </div>
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
              {isReading || isFetchingGithub ? '正在读取素材...' : sourceFiles.length ? '已加入本次分析' : '添加 PRD、代码或配置资料'}
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
          <button
            type="button"
            className="flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 text-label-md text-on-surface transition-colors hover:bg-surface-variant"
            onClick={openCodeRepositoryPicker}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>terminal</span>
            添加代码库
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
                setLoadedGithubRepoUrl(null)
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
              清空
            </button>
          ) : null}
        </div>

        <div className="mt-sm grid gap-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={githubRepoUrl}
            onChange={(event) => setGithubRepoUrl(event.target.value)}
            className="min-h-[42px] min-w-0 rounded-lg border border-outline-variant bg-surface px-md py-sm text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-secondary"
            placeholder="https://github.com/org/repo"
          />
          <button
            type="button"
            onClick={() => { void handleFetchGithubRepository() }}
            disabled={!normalizedGithubRepoUrl || isFetchingGithub}
            className={[
              'flex min-h-[42px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-label-md transition-colors',
              normalizedGithubRepoUrl && !isFetchingGithub
                ? 'border border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20'
                : 'cursor-not-allowed border border-outline-variant bg-surface-container text-on-surface-variant opacity-60',
            ].join(' ')}
          >
            <span className={['material-symbols-outlined', isFetchingGithub ? 'animate-spin' : ''].join(' ').trim()} style={{ fontSize: '18px' }}>
              {isFetchingGithub ? 'sync' : 'cloud_download'}
            </span>
            {isFetchingGithub ? '读取中...' : '添加 GitHub'}
          </button>
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
            尚未添加素材。
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
      <input
        ref={codeRepositoryInputRef}
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
