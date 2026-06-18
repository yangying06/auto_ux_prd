import type {
  PrototypeAllowedAsset,
  PrototypeAssetAuditIssue,
  PrototypeAssetManifest,
  PrototypeInterfaceBlueprint,
  PrototypeInterfaceBlueprintNode,
  PrototypeInterfaceRect,
} from '../src/types/prototypeAssets'

const TAILWIND_CDN_URL = 'https://cdn.tailwindcss.com'

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeBooleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalizeRectValue(value: unknown): PrototypeInterfaceRect | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<PrototypeInterfaceRect>
  const x = normalizeNumberValue(raw.x)
  const y = normalizeNumberValue(raw.y)
  const width = normalizeNumberValue(raw.width)
  const height = normalizeNumberValue(raw.height)
  if (x === null || y === null || width === null || height === null) return null
  return { x, y, width, height }
}

function normalizeBlueprintNode(value: unknown): PrototypeInterfaceBlueprintNode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<PrototypeInterfaceBlueprintNode>
  const path = normalizeTextValue(raw.path)
  const name = normalizeTextValue(raw.name)
  const type = normalizeTextValue(raw.type)
  const rect = normalizeRectValue(raw.rect)
  if (!path || !name || !type || !rect) return null
  return {
    path,
    name,
    type,
    rect,
    asset: normalizeTextValue(raw.asset),
    text: normalizeTextValue(raw.text),
    visible: normalizeBooleanValue(raw.visible),
  }
}

function normalizeInterfaceBlueprint(value: unknown): PrototypeInterfaceBlueprint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<PrototypeInterfaceBlueprint>
  const id = normalizeTextValue(raw.id)
  const name = normalizeTextValue(raw.name)
  if (!id || !name) return null
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.map(normalizeBlueprintNode).filter((node): node is PrototypeInterfaceBlueprintNode => Boolean(node)).slice(0, 80)
    : []
  const root = normalizeBlueprintNode(raw.root) ?? nodes[0] ?? null
  const designSize = raw.designSize && typeof raw.designSize === 'object'
    ? {
        width: normalizeNumberValue((raw.designSize as { width?: unknown }).width),
        height: normalizeNumberValue((raw.designSize as { height?: unknown }).height),
      }
    : null
  return {
    id,
    name,
    sourceRowId: normalizeTextValue(raw.sourceRowId),
    sourceUrl: normalizeTextValue(raw.sourceUrl),
    uiSpecPath: normalizeTextValue(raw.uiSpecPath),
    uiSpecUrl: normalizeTextValue(raw.uiSpecUrl),
    manifestPath: normalizeTextValue(raw.manifestPath),
    manifestUrl: normalizeTextValue(raw.manifestUrl),
    htmlAvailable: raw.htmlAvailable === true,
    designSize,
    root,
    nodes,
    assetNames: Array.isArray(raw.assetNames)
      ? raw.assetNames.map((asset) => normalizeTextValue(asset)).filter((asset): asset is string => Boolean(asset)).slice(0, 80)
      : [],
    assetCount: normalizeNumberValue(raw.assetCount),
    nodeCount: normalizeNumberValue(raw.nodeCount),
  }
}

export function normalizePrototypeAssetManifest(value: unknown): PrototypeAssetManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<PrototypeAssetManifest>
  const mode = raw.mode === 'strict' ? 'strict' : 'audit'
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
          if (!['interface_html', 'interface_image', 'ui_image', 'effect_preview'].includes(String(kind))) return null
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
  const interfaceBlueprints = Array.isArray(raw.interfaceBlueprints)
    ? raw.interfaceBlueprints
        .map(normalizeInterfaceBlueprint)
        .filter((blueprint): blueprint is PrototypeInterfaceBlueprint => Boolean(blueprint))
        .slice(0, 12)
    : []
  return { mode, assets, notes, interfaceBlueprints }
}

function formatPrototypeAssetKind(kind: PrototypeAllowedAsset['kind']) {
  if (kind === 'interface_html') return '界面HTML底板'
  if (kind === 'interface_image') return '界面子图'
  if (kind === 'ui_image') return '散图/图标/item'
  return '特效预览'
}

function formatBlueprintRect(rect: PrototypeInterfaceRect) {
  return `x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height}`
}

function formatBlueprintNode(node: PrototypeInterfaceBlueprintNode) {
  const text = node.text ? `, text="${node.text}"` : ''
  const asset = node.asset ? `, asset=${node.asset}` : ''
  const hidden = node.visible === false ? ', hidden' : ''
  return `- ${node.path} | ${node.name} [${node.type}] | rect(${formatBlueprintRect(node.rect)})${asset}${text}${hidden}`
}

function buildInterfaceBlueprintSection(blueprints: PrototypeInterfaceBlueprint[]) {
  if (!blueprints.length) return ''
  const content = blueprints.map((blueprint, index) => {
    const designSize = blueprint.designSize?.width && blueprint.designSize?.height
      ? `${blueprint.designSize.width}x${blueprint.designSize.height}`
      : '未记录'
    const nodeCount = blueprint.nodeCount ?? (blueprint.nodes.length || null)
    const assetCount = blueprint.assetCount ?? (blueprint.assetNames.length || null)
    const root = blueprint.root
      ? `${blueprint.root.name} [${blueprint.root.type}] rect(${formatBlueprintRect(blueprint.root.rect)})`
      : '未记录'
    const nodeLines = blueprint.nodes.length
      ? blueprint.nodes.slice(0, 30).map(formatBlueprintNode).join('\n')
      : '- 未缓存节点摘要；仍必须以 ui_spec.json / 已生成 HTML 底板为准。'
    const assetNames = blueprint.assetNames.length ? blueprint.assetNames.slice(0, 60).join(', ') : '未记录'
    return [
      `${index + 1}. ${blueprint.name}`,
      `   ui_spec.json: ${blueprint.uiSpecPath ?? blueprint.uiSpecUrl ?? '未记录路径'}`,
      blueprint.manifestPath || blueprint.manifestUrl ? `   export_manifest: ${blueprint.manifestPath ?? blueprint.manifestUrl}` : null,
      blueprint.sourceUrl ? `   来源: ${blueprint.sourceUrl}` : null,
      `   设计尺寸: ${designSize}`,
      `   根节点: ${root}`,
      `   节点数: ${nodeCount ?? '未知'}；子图数: ${assetCount ?? '未知'}`,
      `   子图资产名: ${assetNames}`,
      '   JSON 节点/rect 摘要:',
      nodeLines,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  return `
界面蓝图契约（来自 ui_spec.json）:
${content}

界面蓝图硬规则:
- ui_spec.json 是“用界面生成”的最高版式依据；不得凭 PRD 或模型想象重排已有界面。
- 必须保留根设计尺寸、已有节点的 rect 坐标/宽高、父子层级、显示/隐藏状态和 node.asset 到子图的映射。
- 已有界面子图必须按清单 URL 真实引用，保持原裁切、比例和层叠关系；不要用 CSS 重新绘制、渐变替代或外部图片替代。
- 只允许新增当前 PRD 节点需要的交互状态、文案、占位状态或验收控件；新增层不能破坏已有界面结构和视觉风格。
`
}

export function buildPrototypeAssetManifestSection(assetManifest?: PrototypeAssetManifest | null) {
  if (!assetManifest) return ''
  const assets = assetManifest.assets.slice(0, 80)
  const isStrict = assetManifest.mode === 'strict'
  const modeName = isStrict ? '资源库标准模式' : '草稿预览素材审核'
  const modeRule = isStrict
    ? '当前原型处于“资源库标准模式”。素材库清单是硬约束：输出 HTML 中出现清单外图片、视频、音频、字体、外链、本地路径或 data URL 都视为不合格。'
    : '当前原型处于“草稿预览素材审核”。你可以生成草稿 HTML，但应优先按下面三类素材规则工作；清单外资源会被审计提示。'
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
  const blueprintSection = buildInterfaceBlueprintSection(assetManifest.interfaceBlueprints ?? [])

  return `
## 素材库使用与审核规则
${modeRule}
1. 界面类素材是页面底板；如果提供了界面HTML/界面资源，必须保留它的布局结构、JSON 节点关系和界面样式，只做最小必要修改。
2. 散图用于 item、图标、奖励、头像、按钮图等内容替换；只能按清单中的规范命名资源使用。
3. 特效不能改原始命名，必须按“用途/备注”理解；只有清单中带 URL 的特效预览才能在 HTML 中表现。没有预览的 Spine/Prefab/粒子资源不要画成真实特效，只能用状态、阶段文案或普通反馈承载。
${blueprintSection}

允许使用的素材库资源:
${assetLines}
${notes}
禁止事项:
- 不要引用素材库清单外的图片、视频、音频、字体、外链资源、本地绝对路径或 base64/data URL。
- 可以使用 Tailwind CDN: ${TAILWIND_CDN_URL}。
- 如果某个素材缺失，用灰色占位或真实界面状态表达，不要虚构资源路径或虚构特效名。
- 如果用户要求替换 item/图标/奖励，优先匹配“散图/图标/item”资源；如果用户要求表现特效，优先匹配“特效预览”资源的用途和备注。
- 模式标记：${modeName}。`
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

function prototypeResourceReferenceKeys(value: string) {
  return new Set([value, prototypeResourcePathKey(value)])
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
  const resourceViolationSeverity = assetManifest.mode === 'strict' ? 'error' : 'warning'
  const refs = extractPrototypeResourceReferences(html)
  if (assetManifest.assets.length === 0) {
    issues.push({
      code: 'empty_manifest',
      severity: 'warning',
      message: '当前素材库没有可用于原型的 ready 资源，本次结果需要人工确认是否使用了占位表现。',
    })
  }

  for (const ref of refs) {
    const lower = ref.toLowerCase()
    if (lower.startsWith('data:')) {
      issues.push({ code: 'data_url', severity: resourceViolationSeverity, message: 'HTML 引用了 base64/data URL，并非来自素材库。', value: ref })
      continue
    }
    if (lower.startsWith('#') || lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:')) continue
    if (isAllowedPrototypeResource(ref, assetManifest)) continue
    if (/^[a-z]+:/iu.test(ref)) {
      issues.push({ code: 'external_resource', severity: resourceViolationSeverity, message: 'HTML 引用了素材库外部资源。', value: ref })
      continue
    }
    issues.push({ code: 'local_path', severity: resourceViolationSeverity, message: 'HTML 引用了未列入素材库清单的本地或相对路径。', value: ref })
  }

  if (assetManifest.mode === 'strict' && (assetManifest.interfaceBlueprints?.length ?? 0) > 0) {
    const usedResourceKeys = new Set<string>()
    for (const ref of refs) {
      for (const key of prototypeResourceReferenceKeys(ref)) usedResourceKeys.add(key)
    }
    for (const asset of assetManifest.assets) {
      if (asset.kind !== 'interface_image' && asset.kind !== 'interface_html') continue
      const requiredKeys = prototypeResourceReferenceKeys(asset.url)
      if ([...requiredKeys].some((key) => usedResourceKeys.has(key))) continue
      issues.push({
        code: 'missing_interface_asset',
        severity: 'error',
        message: `资源库标准模式缺少界面子图引用：${asset.name}。生成结果必须遵照 ui_spec.json 的 node.asset 映射真实引用子图。`,
        value: asset.url,
      })
    }
  }
  return issues
}
