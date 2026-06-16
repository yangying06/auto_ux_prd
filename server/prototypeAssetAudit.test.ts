import assert from 'node:assert/strict'
import {
  auditPrototypeAssets,
  buildPrototypeAssetManifestSection,
  extractPrototypeResourceReferences,
  isAllowedPrototypeResource,
  normalizePrototypeAssetManifest,
} from './prototypeAssetAudit'
import type { PrototypeAssetManifest } from '../src/types/prototypeAssets'

const manifest: PrototypeAssetManifest = {
  mode: 'audit',
  assets: [
    {
      id: 'ui-main:bg',
      kind: 'interface_html',
      name: '主界面 / 背景',
      url: 'http://127.0.0.1:8787/api/figma/assets/bundle-a/assets/bg.png',
      source: 'ui_asset',
      purpose: '页面底板',
      originalName: 'bg.png',
      assetGroupName: '主界面',
    },
    {
      id: 'item:coin',
      kind: 'ui_image',
      name: '金币散图 / coin',
      url: 'http://127.0.0.1:8787/api/figma/assets/bundle-b/items/coin.png?rev=1',
      source: 'ui_asset',
      purpose: '奖励 item',
    },
    {
      id: 'fx:reward-preview',
      kind: 'effect_preview',
      name: 'reward_fx / 预览',
      url: 'http://127.0.0.1:8787/api/assets/effects/file/effect-1/preview/reward.webp',
      source: 'effect_asset',
      purpose: '中奖反馈',
      originalName: 'reward_fx',
    },
  ],
  notes: ['特效「spin_fx」已加载但没有可预览文件，不允许画成真实特效。'],
}

const normalized = normalizePrototypeAssetManifest({
  mode: 'audit',
  assets: [
    manifest.assets[0],
    { id: 'bad-kind', kind: 'unknown', name: 'bad', url: 'http://bad', source: 'ui_asset' },
    { id: '', kind: 'ui_image', name: 'empty id', url: 'http://bad', source: 'ui_asset' },
  ],
  notes: ['  keep me  ', '', 404],
})

assert.equal(normalized?.mode, 'audit')
assert.equal(normalized?.assets.length, 1, 'invalid manifest assets are dropped')
assert.deepEqual(normalized?.notes, ['keep me'], 'notes are trimmed and filtered')

const section = buildPrototypeAssetManifestSection(manifest)
assert.match(section, /素材库审核模式/u)
assert.match(section, /界面HTML底板/u)
assert.match(section, /散图\/图标\/item/u)
assert.match(section, /特效预览/u)
assert.match(section, /没有预览的 Spine\/Prefab\/粒子资源不要画成真实特效/u)

const refs = extractPrototypeResourceReferences(`
  <link href="https://cdn.tailwindcss.com">
  <img src="/api/figma/assets/bundle-a/assets/bg.png">
  <video poster="http://cdn.example.com/poster.png"></video>
  <div style="background-image:url('./local.png')"></div>
`)
assert.deepEqual(refs, [
  'https://cdn.tailwindcss.com',
  '/api/figma/assets/bundle-a/assets/bg.png',
  'http://cdn.example.com/poster.png',
  './local.png',
])

assert.equal(isAllowedPrototypeResource('https://cdn.tailwindcss.com', manifest), true)
assert.equal(isAllowedPrototypeResource('/api/figma/assets/bundle-a/assets/bg.png', manifest), true, 'same path as allowed URL is allowed')
assert.equal(isAllowedPrototypeResource('/api/figma/assets/bundle-b/items/coin.png?rev=1', manifest), true, 'same path/search as allowed URL is allowed')
assert.equal(isAllowedPrototypeResource('https://example.com/other.png', manifest), false)

const issues = auditPrototypeAssets(`
  <!doctype html>
  <html>
    <head><script src="https://cdn.tailwindcss.com"></script></head>
    <body>
      <img src="/api/figma/assets/bundle-a/assets/bg.png">
      <img src="data:image/png;base64,abc">
      <img src="https://example.com/fake.png">
      <div style="background:url('./local.png')"></div>
    </body>
  </html>
`, manifest)

assert.deepEqual(
  issues.map((issue) => issue.code),
  ['data_url', 'external_resource', 'local_path'],
  'audit flags data URLs, external URLs, and unlisted relative paths',
)

const emptyIssues = auditPrototypeAssets('<img src="./placeholder.png">', { mode: 'audit', assets: [], notes: [] })
assert.deepEqual(
  emptyIssues.map((issue) => issue.code),
  ['empty_manifest', 'local_path'],
  'empty manifests require manual review and still flag local paths',
)

console.log('prototypeAssetAudit.test.ts: all assertions passed')
