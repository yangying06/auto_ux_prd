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
      kind: 'interface_image',
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
    {
      id: 'fx:mega-spine',
      kind: 'effect_spine',
      name: 'anim_mega_win / Spine',
      url: 'http://127.0.0.1:8787/api/assets/effects/file/anim_mega_win/anim_mega_win.json',
      source: 'effect_asset',
      purpose: 'mega win effect',
      originalName: 'anim_mega_win',
      assetGroupName: 'anim_mega_win',
      spine: {
        jsonUrl: 'http://127.0.0.1:8787/api/assets/effects/file/anim_mega_win/anim_mega_win.json',
        atlasUrl: 'http://127.0.0.1:8787/api/assets/effects/file/anim_mega_win/anim_mega_win.atlas.txt',
        textureUrls: ['http://127.0.0.1:8787/api/assets/effects/file/anim_mega_win/anim_mega_win.png'],
        animationNames: ['anim_mega_win'],
        skinNames: ['default'],
        defaultAnimation: 'anim_mega_win',
        skeletonVersion: '4.2.43',
        premultipliedAlpha: true,
        playerJsUrl: 'http://127.0.0.1:8787/api/runtime/spine-player/iife/spine-player.min.js',
        playerCssUrl: 'http://127.0.0.1:8787/api/runtime/spine-player/spine-player.css',
      },
    },
    {
      id: 'audio:click',
      kind: 'audio_clip',
      name: 'button_click / 音频',
      url: 'http://127.0.0.1:8787/api/assets/audio/file/ui/button_click.mp3',
      source: 'audio_asset',
      purpose: '按钮点击音效',
      originalName: 'button_click.mp3',
      assetGroupName: 'button_click',
    },
  ],
  interfaceBlueprints: [
    {
      id: 'ui-main',
      name: '主界面',
      sourceRowId: 'ui-main',
      sourceUrl: 'https://figma.com/design/file?node-id=1-2',
      uiSpecPath: 'D:/cache/UISlots/ui_spec.json',
      uiSpecUrl: 'http://127.0.0.1:8787/api/figma/assets/bundle-a/UISlots/ui_spec.json',
      manifestPath: 'D:/cache/UISlots/export_manifest.json',
      manifestUrl: 'http://127.0.0.1:8787/api/figma/assets/bundle-a/UISlots/export_manifest.json',
      htmlAvailable: true,
      designSize: { width: 750, height: 1624 },
      root: {
        path: 'root',
        name: '主界面',
        type: 'Frame',
        rect: { x: 0, y: 0, width: 750, height: 1624 },
        asset: null,
        text: null,
        visible: null,
      },
      nodes: [
        {
          path: 'root',
          name: '主界面',
          type: 'Frame',
          rect: { x: 0, y: 0, width: 750, height: 1624 },
          asset: null,
          text: null,
          visible: null,
        },
        {
          path: 'root/1:bg',
          name: '背景',
          type: 'Sprite',
          rect: { x: 0, y: 0, width: 750, height: 1624 },
          asset: 'bg.png',
          text: null,
          visible: null,
        },
      ],
      assetNames: ['bg.png'],
      assetCount: 1,
      nodeCount: 2,
    },
  ],
  reusableLogicAssets: [
    {
      id: 'logic-reward-feedback',
      name: '奖励弹窗反馈节奏',
      type: 'feedback_pattern',
      status: 'approved',
      reuseMode: 'reference',
      description: '奖励结果出现后的反馈节奏。',
      logic: '先展示奖励弹窗，再播放奖励入账反馈，最后刷新按钮状态。',
      usageGuidance: '复用时必须确认当前奖励资源和结束状态。',
      tags: ['奖励', '反馈'],
      source: {
        nodeId: 'NODE-REWARD',
        nodeLabel: '奖励结算',
        field: 'performanceSpec',
        excerpt: '奖励弹窗反馈节奏',
      },
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    },
  ],
  notes: ['特效「spin_fx」已加载但没有可预览文件，不允许画成真实特效。'],
}

const normalized = normalizePrototypeAssetManifest({
  mode: 'strict',
  assets: [
    manifest.assets[0],
    manifest.assets[3],
    { id: 'bad-kind', kind: 'unknown', name: 'bad', url: 'http://bad', source: 'ui_asset' },
    { id: '', kind: 'ui_image', name: 'empty id', url: 'http://bad', source: 'ui_asset' },
  ],
  interfaceBlueprints: manifest.interfaceBlueprints,
  reusableLogicAssets: [
    manifest.reusableLogicAssets?.[0],
    { ...(manifest.reusableLogicAssets?.[0] ?? {}), id: 'logic-candidate', status: 'candidate' },
  ],
  notes: ['  keep me  ', '', 404],
})

assert.equal(normalized?.mode, 'strict')
assert.equal(normalized?.assets.length, 2, 'invalid manifest assets are dropped')
assert.equal(normalized?.assets[1]?.spine?.defaultAnimation, 'anim_mega_win', 'spine metadata is preserved')
assert.deepEqual(normalized?.notes, ['keep me'], 'notes are trimmed and filtered')
assert.equal(normalized?.interfaceBlueprints?.length, 1, 'interface blueprints are normalized')
assert.equal(normalized?.interfaceBlueprints[0]?.root?.rect.width, 750, 'interface blueprint root rect is preserved')
assert.equal(normalized?.reusableLogicAssets?.length, 1, 'only approved reusable logic assets are kept')
assert.equal(normalized?.reusableLogicAssets?.[0]?.name, '奖励弹窗反馈节奏', 'approved reusable logic asset is preserved')

const section = buildPrototypeAssetManifestSection(manifest)
assert.match(section, /草稿预览素材审核/u)
assert.match(section, /界面子图/u)
assert.match(section, /散图\/图标\/item/u)
assert.match(section, /特效预览/u)
assert.match(section, /Spine playable effect/u)
assert.match(section, /Audio clip/u)
assert.match(section, /jsonUrl: http:\/\/127\.0\.0\.1:8787\/api\/assets\/effects\/file\/anim_mega_win\/anim_mega_win\.json/u)
assert.match(section, /animations: anim_mega_win/u)
assert.match(section, /ui_spec\.json 是“用界面生成”的最高版式依据/u)
assert.match(section, /root\/1:bg \| 背景 \[Sprite\] \| rect\(x=0, y=0, w=750, h=1624\)/u)
assert.match(section, /Standard reusable performance logic/u)
assert.match(section, /奖励弹窗反馈节奏/u)

const strictSection = buildPrototypeAssetManifestSection({ ...manifest, mode: 'strict' })
assert.match(strictSection, /资源库标准模式/u)
assert.match(strictSection, /硬约束/u)

const refs = extractPrototypeResourceReferences(`
  <link href="https://cdn.tailwindcss.com">
  <link href="/api/runtime/spine-player/spine-player.css">
  <script src="/api/runtime/spine-player/iife/spine-player.min.js"></script>
  <img src="/api/figma/assets/bundle-a/assets/bg.png">
  <video poster="http://cdn.example.com/poster.png"></video>
  <div style="background-image:url('./local.png')"></div>
  <script>const clickSfx = new Audio('/api/assets/audio/file/ui/button_click.mp3')</script>
  <script>new spine.SpinePlayer('mega', { jsonUrl: '/api/assets/effects/file/anim_mega_win/anim_mega_win.json', atlasUrl: '/api/assets/effects/file/anim_mega_win/anim_mega_win.atlas.txt', textureUrls: ['/api/assets/effects/file/anim_mega_win/anim_mega_win.png'] })</script>
`)
assert.deepEqual(refs, [
  'https://cdn.tailwindcss.com',
  '/api/runtime/spine-player/spine-player.css',
  '/api/runtime/spine-player/iife/spine-player.min.js',
  '/api/figma/assets/bundle-a/assets/bg.png',
  'http://cdn.example.com/poster.png',
  './local.png',
  '/api/assets/audio/file/ui/button_click.mp3',
  '/api/assets/effects/file/anim_mega_win/anim_mega_win.json',
  '/api/assets/effects/file/anim_mega_win/anim_mega_win.atlas.txt',
  '/api/assets/effects/file/anim_mega_win/anim_mega_win.png',
])

assert.equal(isAllowedPrototypeResource('https://cdn.tailwindcss.com', manifest), true)
assert.equal(isAllowedPrototypeResource('/api/figma/assets/bundle-a/assets/bg.png', manifest), true, 'same path as allowed URL is allowed')
assert.equal(isAllowedPrototypeResource('/api/figma/assets/bundle-b/items/coin.png?rev=1', manifest), true, 'same path/search as allowed URL is allowed')
assert.equal(isAllowedPrototypeResource('/api/runtime/spine-player/iife/spine-player.min.js', manifest), true, 'local Spine Player runtime is allowed')
assert.equal(isAllowedPrototypeResource('/api/assets/effects/file/anim_mega_win/anim_mega_win.atlas.txt', manifest), true, 'spine atlas URL is allowed')
assert.equal(isAllowedPrototypeResource('/api/assets/audio/file/ui/button_click.mp3', manifest), true, 'audio clip URL is allowed')
assert.equal(isAllowedPrototypeResource('https://example.com/other.png', manifest), false)

const issues = auditPrototypeAssets(`
  <!doctype html>
  <html>
    <head><script src="https://cdn.tailwindcss.com"></script></head>
    <body>
      <link href="/api/runtime/spine-player/spine-player.css">
      <script src="/api/runtime/spine-player/iife/spine-player.min.js"></script>
      <img src="/api/figma/assets/bundle-a/assets/bg.png">
      <script>new spine.SpinePlayer('mega', { jsonUrl: '/api/assets/effects/file/anim_mega_win/anim_mega_win.json', atlasUrl: '/api/assets/effects/file/anim_mega_win/anim_mega_win.atlas.txt' })</script>
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

const strictIssues = auditPrototypeAssets('<img src="https://example.com/fake.png">', { ...manifest, mode: 'strict' })
assert.deepEqual(
  strictIssues.map((issue) => issue.severity),
  ['error', 'error'],
  'strict mode upgrades resource violations to errors and requires interface child images',
)
assert.deepEqual(strictIssues.map((issue) => issue.code), ['external_resource', 'missing_interface_asset'])

const emptyIssues = auditPrototypeAssets('<img src="./placeholder.png">', { mode: 'audit', assets: [], notes: [] })
assert.deepEqual(
  emptyIssues.map((issue) => issue.code),
  ['empty_manifest', 'local_path'],
  'empty manifests require manual review and still flag local paths',
)

console.log('prototypeAssetAudit.test.ts: all assertions passed')
