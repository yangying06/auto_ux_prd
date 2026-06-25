import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type {
  ProjectBaselineScan,
  ProjectBaselineScanPolicy,
  ProjectCodeEvidenceKind,
  ProjectCodebaseEvidence,
  ProjectPlatformCandidate,
  SupportedProjectPlatform,
} from '../src/types/projectWorkflow'

const DEFAULT_POLICY: ProjectBaselineScanPolicy = {
  maxFiles: 1600,
  maxBytesPerFile: 48 * 1024,
  maxEvidence: 24,
  fullProjectRead: false,
}

const IGNORED_DIRS = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.vscode',
  'build',
  'dist',
  'node_modules',
  'Pods',
  'DerivedData',
  'Library',
  'Temp',
  'obj',
  'bin',
])

const SCANNABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.svelte',
  '.html',
  '.css',
  '.scss',
  '.json',
  '.xml',
  '.kt',
  '.java',
  '.swift',
  '.m',
  '.mm',
  '.storyboard',
  '.xib',
  '.plist',
  '.strings',
  '.cs',
  '.prefab',
  '.unity',
  '.scene',
  '.fire',
  '.asset',
  '.uxml',
  '.uss',
  '.md',
  '.txt',
])

const STOP_WORDS = new Set([
  'the',
  'and',
  'with',
  'from',
  'this',
  'that',
  'page',
  'screen',
  'button',
  'view',
  '功能',
  '界面',
  '页面',
  '新增',
  '迭代',
  '需求',
  '一个',
  '这个',
  '需要',
  '支持',
])

const PLATFORM_STRATEGY: Record<SupportedProjectPlatform, string> = {
  android: 'Read Manifest, navigation graph, Activity/Fragment/Compose/layout XML, click handlers, string resources, and drawable/layout assets related to the PRD terms.',
  ios: 'Read Xcode project hints, ViewController/SwiftUI/Storyboard/XIB, IBAction/navigation code, Localizable.strings, and asset catalog names related to the PRD terms.',
  h5: 'Read routes/pages/components/state/i18n/styles and use runtime screenshots later when available; keep route/component evidence under interface nodes.',
  cocos: 'Read scene/prefab node trees, bound scripts, UI components, resources, and event handlers related to the PRD terms.',
  unity: 'Read scenes/prefabs/Canvas UI, MonoBehaviour scripts, Addressables/resources, and TextMeshPro/localization files related to the PRD terms.',
  unknown: 'Use filename/path/content recall first, then ask the user to confirm platform and target interface before deep analysis.',
}

interface ScanFileCandidate {
  absolutePath: string
  relativePath: string
  extension: string
}

interface ScoredFileCandidate extends ScanFileCandidate {
  matchedTerms: string[]
  score: number
  snippet: string | null
  lineStart: number | null
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, '/')
}

function safeReadDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function safeStat(filePath: string) {
  try {
    return statSync(filePath)
  } catch {
    return null
  }
}

function fileExists(rootPath: string, ...segments: string[]) {
  return existsSync(path.join(rootPath, ...segments))
}

function collectPathSignals(rootPath: string, maxDepth = 3) {
  const signals = new Set<string>()
  const stack: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }]
  while (stack.length) {
    const current = stack.pop()
    if (!current || current.depth > maxDepth) continue
    for (const entry of safeReadDir(current.dir)) {
      const absolutePath = path.join(current.dir, entry.name)
      const relativePath = normalizeSlash(path.relative(rootPath, absolutePath))
      signals.add(relativePath)
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        stack.push({ dir: absolutePath, depth: current.depth + 1 })
      }
    }
  }
  return signals
}

function platformCandidate(platform: SupportedProjectPlatform, confidence: number, signals: string[]): ProjectPlatformCandidate {
  return {
    platform,
    confidence,
    signals: Array.from(new Set(signals)).slice(0, 8),
    strategy: PLATFORM_STRATEGY[platform],
  }
}

export function detectProjectPlatforms(rootPath: string): ProjectPlatformCandidate[] {
  const pathSignals = collectPathSignals(rootPath)
  const hasSignal = (pattern: RegExp) => Array.from(pathSignals).some((signal) => pattern.test(signal))
  const candidates: ProjectPlatformCandidate[] = []

  const androidSignals = [
    fileExists(rootPath, 'build.gradle') ? 'build.gradle' : null,
    fileExists(rootPath, 'settings.gradle') ? 'settings.gradle' : null,
    fileExists(rootPath, 'AndroidManifest.xml') ? 'AndroidManifest.xml' : null,
    hasSignal(/AndroidManifest\.xml$/u) ? 'AndroidManifest.xml' : null,
    hasSignal(/src\/main\/res\/layout\//u) ? 'res/layout' : null,
    hasSignal(/\.(kt|java)$/u) ? 'Kotlin/Java source' : null,
  ].filter((item): item is string => Boolean(item))
  if (androidSignals.length) candidates.push(platformCandidate('android', Math.min(95, 35 + androidSignals.length * 15), androidSignals))

  const iosSignals = [
    hasSignal(/\.xcodeproj(\/|$)/u) ? '.xcodeproj' : null,
    hasSignal(/\.xcworkspace(\/|$)/u) ? '.xcworkspace' : null,
    hasSignal(/Info\.plist$/u) ? 'Info.plist' : null,
    hasSignal(/\.(storyboard|xib)$/u) ? 'Storyboard/XIB' : null,
    hasSignal(/Assets\.xcassets/u) ? 'Assets.xcassets' : null,
    hasSignal(/\.swift$/u) ? 'Swift source' : null,
  ].filter((item): item is string => Boolean(item))
  if (iosSignals.length) candidates.push(platformCandidate('ios', Math.min(95, 30 + iosSignals.length * 14), iosSignals))

  const h5Signals = [
    fileExists(rootPath, 'package.json') ? 'package.json' : null,
    hasSignal(/src\/(pages|routes|components)\//u) ? 'src pages/routes/components' : null,
    hasSignal(/\.(vue|tsx|jsx|svelte)$/u) ? 'web component source' : null,
    hasSignal(/vite\.config|next\.config|nuxt\.config/u) ? 'web build config' : null,
  ].filter((item): item is string => Boolean(item))
  if (h5Signals.length) candidates.push(platformCandidate('h5', Math.min(95, 35 + h5Signals.length * 15), h5Signals))

  const cocosSignals = [
    fileExists(rootPath, 'project.json') ? 'project.json' : null,
    fileExists(rootPath, 'assets') && hasSignal(/assets\/.+\.(scene|prefab|fire)$/u) ? 'Cocos scene/prefab assets' : null,
    hasSignal(/settings\/builder\.json/u) ? 'Cocos settings' : null,
    hasSignal(/\.(scene|prefab|fire)$/u) ? 'scene/prefab files' : null,
  ].filter((item): item is string => Boolean(item))
  if (cocosSignals.length) candidates.push(platformCandidate('cocos', Math.min(95, 35 + cocosSignals.length * 15), cocosSignals))

  const unitySignals = [
    fileExists(rootPath, 'ProjectSettings', 'ProjectVersion.txt') ? 'ProjectSettings/ProjectVersion.txt' : null,
    fileExists(rootPath, 'Assets') && hasSignal(/Assets\/.+\.(unity|prefab)$/u) ? 'Unity scenes/prefabs' : null,
    hasSignal(/Packages\/manifest\.json$/u) ? 'Packages/manifest.json' : null,
    hasSignal(/\.asmdef$/u) ? 'asmdef' : null,
    hasSignal(/\.cs$/u) ? 'C# source' : null,
  ].filter((item): item is string => Boolean(item))
  if (unitySignals.length) candidates.push(platformCandidate('unity', Math.min(95, 35 + unitySignals.length * 15), unitySignals))

  return candidates.length
    ? candidates.sort((a, b) => b.confidence - a.confidence || a.platform.localeCompare(b.platform))
    : [platformCandidate('unknown', 20, ['No strong platform marker found'])]
}

export function deriveIterationQueryTerms(text: string, focus = '') {
  const combined = `${focus}\n${text}`.toLowerCase()
  const rawTerms = combined.match(/[\p{Script=Han}a-z0-9_-]{2,}/giu) ?? []
  const terms = new Set<string>()
  for (const rawTerm of rawTerms) {
    const term = rawTerm.trim().replace(/^[-_]+|[-_]+$/g, '')
    if (!term || STOP_WORDS.has(term) || term.length > 32) continue
    terms.add(term)
    if (/[\p{Script=Han}]/u.test(term) && term.length >= 4) {
      for (let index = 0; index <= term.length - 2; index += 2) {
        const slice = term.slice(index, index + 2)
        if (!STOP_WORDS.has(slice)) terms.add(slice)
      }
    }
  }
  return Array.from(terms).slice(0, 36)
}

function collectScannableFiles(rootPath: string, policy: ProjectBaselineScanPolicy) {
  const files: ScanFileCandidate[] = []
  const warnings: string[] = []
  const stack = [rootPath]
  let visited = 0

  while (stack.length && visited < policy.maxFiles) {
    const dir = stack.pop()
    if (!dir) continue
    for (const entry of safeReadDir(dir)) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = normalizeSlash(path.relative(rootPath, absolutePath))
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      visited += 1
      const extension = path.extname(entry.name).toLowerCase()
      if (!SCANNABLE_EXTENSIONS.has(extension)) continue
      files.push({ absolutePath, relativePath, extension })
      if (visited >= policy.maxFiles) break
    }
  }

  if (stack.length || visited >= policy.maxFiles) {
    warnings.push(`Scan stopped after ${visited} files; refine PRD focus or raise scan limits for broader evidence.`)
  }
  return { files, warnings }
}

function filePlatform(relativePath: string, extension: string, platforms: ProjectPlatformCandidate[]): SupportedProjectPlatform {
  const pathText = relativePath.toLowerCase()
  if (/androidmanifest|\/res\/|\.kt$|\.java$/u.test(pathText)) return 'android'
  if (/\.(swift|storyboard|xib|plist|strings)$/u.test(pathText) || pathText.includes('.xcassets')) return 'ios'
  if (/\.(vue|tsx|jsx|svelte|html|css|scss)$/u.test(pathText) || pathText.includes('/routes/') || pathText.includes('/pages/')) return 'h5'
  if (/\.(scene|fire)$/u.test(pathText) || pathText.includes('/cocos/') || (extension === '.prefab' && platforms.some((item) => item.platform === 'cocos'))) return 'cocos'
  if (/\.(unity|cs|uxml|uss)$/u.test(pathText) || pathText.startsWith('assets/') || pathText.includes('/addressables/')) return 'unity'
  return platforms[0]?.platform ?? 'unknown'
}

function evidenceKind(relativePath: string): ProjectCodeEvidenceKind {
  const text = relativePath.toLowerCase()
  if (/manifest|config|settings|package\.json|project\.json|\.plist$/u.test(text)) return 'config'
  if (/router|route|navigation|navgraph|coordinator/u.test(text)) return 'navigation'
  if (/screen|page|scene|viewcontroller|activity|fragment|storyboard|xib|\.(scene|unity)$/u.test(text)) return 'screen'
  if (/component|widget|view|panel|prefab|canvas/u.test(text)) return 'component'
  if (/assets?|resources?|drawable|xcassets|addressables|audio|spine|effect/u.test(text)) return 'asset'
  if (/strings|i18n|localizable|locale|lang/u.test(text)) return 'text'
  if (/store|controller|manager|system|service|handler/u.test(text)) return 'logic'
  return 'unknown'
}

function findBestSnippet(text: string, terms: string[]) {
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const lower = lines[index].toLowerCase()
    if (!terms.some((term) => lower.includes(term.toLowerCase()))) continue
    const start = Math.max(0, index - 2)
    const end = Math.min(lines.length, index + 4)
    return {
      lineStart: start + 1,
      snippet: lines.slice(start, end).join('\n').slice(0, 1400),
    }
  }
  return { lineStart: null, snippet: null }
}

function scoreFile(file: ScanFileCandidate, terms: string[], platforms: ProjectPlatformCandidate[]): ScoredFileCandidate | null {
  const pathText = file.relativePath.toLowerCase()
  const pathMatches = terms.filter((term) => pathText.includes(term.toLowerCase()))
  let score = pathMatches.length * 8
  let text = ''

  const stat = safeStat(file.absolutePath)
  if (!stat || stat.size > DEFAULT_POLICY.maxBytesPerFile * 5) return pathMatches.length ? { ...file, matchedTerms: pathMatches, score, snippet: null, lineStart: null } : null

  try {
    text = readFileSync(file.absolutePath, 'utf8').slice(0, DEFAULT_POLICY.maxBytesPerFile)
  } catch {
    text = ''
  }

  const lowerText = text.toLowerCase()
  const contentMatches = terms.filter((term) => lowerText.includes(term.toLowerCase()))
  const matchedTerms = Array.from(new Set([...pathMatches, ...contentMatches]))
  if (!matchedTerms.length) return null

  score += contentMatches.length * 5
  const kind = evidenceKind(file.relativePath)
  if (kind === 'screen' || kind === 'component') score += 8
  if (kind === 'navigation' || kind === 'text') score += 4
  const platform = filePlatform(file.relativePath, file.extension, platforms)
  if (platform !== 'unknown') score += 2

  return {
    ...file,
    matchedTerms,
    score,
    ...findBestSnippet(text, matchedTerms),
  }
}

function evidenceTitle(relativePath: string) {
  return path.basename(relativePath).replace(/\.[^.]+$/u, '') || relativePath
}

function toEvidence(file: ScoredFileCandidate, index: number, platforms: ProjectPlatformCandidate[]): ProjectCodebaseEvidence {
  const kind = evidenceKind(file.relativePath)
  const platform = filePlatform(file.relativePath, file.extension, platforms)
  return {
    id: `code-${index + 1}`,
    title: evidenceTitle(file.relativePath),
    relativePath: file.relativePath,
    kind,
    platform,
    reason: `${kind} candidate matched ${file.matchedTerms.slice(0, 6).join(', ')}`,
    matchedTerms: file.matchedTerms.slice(0, 10),
    confidence: Math.max(30, Math.min(96, Math.round(35 + file.score * 2.2))),
    lineStart: file.lineStart,
    snippet: file.snippet,
  }
}

export interface ProjectBaselineScanRequest {
  rootPath: string
  iterationPrd: string
  focus?: string
}

export function scanProjectBaseline(input: ProjectBaselineScanRequest): ProjectBaselineScan {
  const rootPath = path.resolve(input.rootPath)
  if (!existsSync(rootPath)) throw new Error(`Codebase path does not exist: ${rootPath}`)
  const rootStat = statSync(rootPath)
  if (!rootStat.isDirectory()) throw new Error(`Codebase path is not a directory: ${rootPath}`)

  const policy = DEFAULT_POLICY
  const platforms = detectProjectPlatforms(rootPath)
  const queryTerms = deriveIterationQueryTerms(input.iterationPrd, input.focus)
  const { files, warnings } = collectScannableFiles(rootPath, policy)
  const scoredFiles = files
    .map((file) => scoreFile(file, queryTerms, platforms))
    .filter((file): file is ScoredFileCandidate => Boolean(file))
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
  const evidence = scoredFiles.slice(0, policy.maxEvidence).map((file, index) => toEvidence(file, index, platforms))

  if (!queryTerms.length) warnings.push('No strong PRD focus terms were derived; ask the user for a clearer iteration target before deep analysis.')
  if (!evidence.length) warnings.push('No targeted code evidence matched the iteration PRD; keep the mind map PRD-led and ask for the specific interface/module name.')

  return {
    rootPath,
    scannedAt: new Date().toISOString(),
    queryTerms,
    platforms,
    evidence,
    warnings,
    summary: [
      `Detected ${platforms.map((item) => `${item.platform}:${item.confidence}%`).join(', ') || 'unknown platform'}.`,
      `Recalled ${evidence.length} focused evidence file(s) from ${files.length} scannable file(s); full project read is disabled.`,
    ].join(' '),
    policy,
  }
}
