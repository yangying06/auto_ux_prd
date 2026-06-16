import type { PrototypeAllowedAsset, PrototypeAssetAuditIssue, PrototypeAssetManifest } from '../src/types/prototypeAssets'

const TAILWIND_CDN_URL = 'https://cdn.tailwindcss.com'

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizePrototypeAssetManifest(value: unknown): PrototypeAssetManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<PrototypeAssetManifest>
  const assets = Array.isArray(raw.assets)
    ? raw.assets
        .map((asset): PrototypeAllowedAsset | null => {
          if (!asset || typeof asset !== 'object') return null
          const item = asset as Partial<PrototypeAllowedAsset>
          const id = normalizeTextValue(item.id)
          const name = normalizeTextValue(item.name)
          const url = normalizeTextValue(item.url)
          const kind = item.kind
          const source = item.source
          if (!id || !name || !url) return null
          if (!['interface_html', 'ui_image', 'effect_preview'].includes(String(kind))) return null
          if (!['ui_asset', 'effect_asset'].includes(String(source))) return null
          return {
            id,
            kind: kind as PrototypeAllowedAsset['kind'],
            name,
            url,
            source: source as PrototypeAllowedAsset['source'],
            purpose: normalizeTextValue(item.purpose),
            usageNote: normalizeTextValue(item.usageNote),
            originalName: normalizeTextValue(item.originalName),
            assetGroupName: normalizeTextValue(item.assetGroupName),
          }
        })
        .filter((asset): asset is PrototypeAllowedAsset => Boolean(asset))
    : []
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((note) => normalizeTextValue(note)).filter((note): note is string => Boolean(note))
    : []
  return { mode: 'audit', assets, notes }
}

function formatPrototypeAssetKind(kind: PrototypeAllowedAsset['kind']) {
  if (kind === 'interface_html') return '界面HTML底板'
  if (kind === 'ui_image') return '散图/图标/item'
  return '特效预览'
}

export function buildPrototypeAssetManifestSection(assetManifest?: PrototypeAssetManifest | null) {
  if (!assetManifest) return ''
  const assets = assetManifest.assets.slice(0, 80)
  const assetLines = assets.length
    ? assets.map((asset, index) => [
        `${index + 1}. [${formatPrototypeAssetKind(asset.kind)}] ${asset.name}`,
        asset.assetGroupName ? `   分组: ${asset.assetGroupName}` : null,
        asset.originalName ? `   原始名: ${asset.originalName}` : null,
        asset.purpose ? `   用途: ${asset.purpose}` : null,
        asset.usageNote ? `   备注: ${asset.usageNote}` : null,
        `   URL: ${asset.url}`,
      ].filter(Boolean).join('\n')).join('\n')
    : '（当前素材库没有可用于原型的 ready 资源）'
  const notes = assetManifest.notes.length
    ? `\n素材库备注:\n${assetManifest.notes.map((note) => `- ${note}`).join('\n')}\n`
    : ''

  return `
## 素材库使用与审核规则
当前原型处于“素材库审核模式”。你可以生成 HTML，但必须按下面三类素材规则工作：
1. 界面类素材是页面底板；如果提供了界面HTML/界面资源，优先保留它的布局结构，只做最小必要修改。
2. 散图用于 item、图标、奖励、头像、按钮图等内容替换；只能按清单中的规范命名资源使用。
3. 特效不能改原始命名，必须按“用途/备注”理解；只有清单中带 URL 的特效预览才能在 HTML 中表现。没有预览的 Spine/Prefab/粒子资源不要画成真实特效，只能用状态、阶段文案或普通反馈承载。

允许使用的素材库资源:
${assetLines}
${notes}
禁止事项:
- 不要引用素材库清单外的图片、视频、音频、字体、外链资源、本地绝对路径或 base64/data URL。
- 可以使用 Tailwind CDN: ${TAILWIND_CDN_URL}。
- 如果某个素材缺失，用灰色占位或真实界面状态表达，不要虚构资源路径或虚构特效名。
- 如果用户要求替换 item/图标/奖励，优先匹配“散图/图标/item”资源；如果用户要求表现特效，优先匹配“特效预览”资源的用途和备注。`
}

export function extractPrototypeResourceReferences(html: string) {
  const refs: string[] = []
  const attrPattern = /\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/giu
  const cssUrlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/giu
  for (const match of html.matchAll(attrPattern)) {
    const value = match[2]?.trim()
    if (value) refs.push(value)
  }
  for (const match of html.matchAll(cssUrlPattern)) {
    const value = match[2]?.trim()
    if (value) refs.push(value)
  }
  return Array.from(new Set(refs))
}

function prototypeResourcePathKey(value: string) {
  try {
    const parsed = new URL(value)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return value
  }
}

export function isAllowedPrototypeResource(value: string, assetManifest: PrototypeAssetManifest) {
  if (value === TAILWIND_CDN_URL) return true
  const allowed = new Set(assetManifest.assets.map((asset) => asset.url))
  if (allowed.has(value)) return true
  const valueKey = prototypeResourcePathKey(value)
  return assetManifest.assets.some((asset) => prototypeResourcePathKey(asset.url) === valueKey)
}

export function auditPrototypeAssets(html: string | null, assetManifest?: PrototypeAssetManifest | null): PrototypeAssetAuditIssue[] {
  if (!html || !assetManifest) return []
  const issues: PrototypeAssetAuditIssue[] = []
  if (assetManifest.assets.length === 0) {
    issues.push({
      code: 'empty_manifest',
      severity: 'warning',
      message: '当前素材库没有可用于原型的 ready 资源，本次结果需要人工确认是否使用了占位表现。',
    })
  }

  for (const ref of extractPrototypeResourceReferences(html)) {
    const lower = ref.toLowerCase()
    if (lower.startsWith('data:')) {
      issues.push({ code: 'data_url', severity: 'warning', message: 'HTML 引用了 base64/data URL，并非来自素材库。', value: ref })
      continue
    }
    if (lower.startsWith('#') || lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:')) continue
    if (isAllowedPrototypeResource(ref, assetManifest)) continue
    if (/^[a-z]+:/iu.test(ref)) {
      issues.push({ code: 'external_resource', severity: 'warning', message: 'HTML 引用了素材库外部资源。', value: ref })
      continue
    }
    issues.push({ code: 'local_path', severity: 'warning', message: 'HTML 引用了未列入素材库清单的本地或相对路径。', value: ref })
  }
  return issues
}
