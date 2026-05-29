import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('D:/npm-global/node_modules/dev-browser/node_modules/playwright')

const artifactDir = 'D:/learn/auto_ux_prd/.planning/quick/260529-fty-markdown'
const mdPath = path.join(artifactDir, 'e2e-mock-prd.md')
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const screenshots = []

async function shot(name, targetPage = page) {
  const file = path.join(artifactDir, name)
  await targetPage.screenshot({ path: file, fullPage: false })
  screenshots.push(file)
}

await page.addInitScript(() => localStorage.clear())
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.locator('input[type="file"]').setInputFiles(mdPath)
await page.waitForTimeout(350)
await shot('e2e-01-dynamic-parse-empty.png')
await page.waitForTimeout(1200)
await shot('e2e-02-dynamic-parse-live-tree.png')
await page.waitForFunction(() => document.querySelectorAll('[data-node-card="true"]').length >= 8, null, { timeout: 10000 })
await page.waitForTimeout(300)
await shot('e2e-03-final-map-from-upload.png')

const uploadFlow = await page.evaluate(() => ({
  cardCount: document.querySelectorAll('[data-node-card="true"]').length,
  lineCount: document.querySelectorAll('.svg-line').length,
  hasViewMapScreen: document.body.textContent?.includes('查看导图') ?? false,
  hasDynamicHint: document.body.textContent?.includes('解析结果会直接刷新到导图画布') ?? false,
  hasUploadButton: document.body.textContent?.includes('上传PRD文档') ?? false,
  hasExportButton: document.body.textContent?.includes('导出文档包') ?? false,
  animationNames: [...document.querySelectorAll('.svg-line')].slice(0, 3).map((el) => getComputedStyle(el).animationName),
}))

const tree = {
  ROOT: {
    id: 'ROOT',
    parentId: null,
    label: '多人竞技活动 PRD',
    summary: '活动文档索引。',
    content: '## 文档目标\n\n- 明确活动入口\n- 输出接口边界\n\n| 模块 | 责任 |\n| --- | --- |\n| 客户端 | 入口、结果页 |\n| 服务端 | 结算、接口 |',
    type: 'module',
    status: 'pending',
    level: 0,
    order: 0,
    needsPolish: false,
    extractedFrom: null,
    techNotes: null,
    children: ['CLIENT', 'SERVER'],
    docPath: 'README.md',
    audience: 'overview',
    handoffGoal: '作为 AI 接力入口。',
    qualityGate: '目录完整。',
  },
  CLIENT: {
    id: 'CLIENT',
    parentId: 'ROOT',
    label: '客户端交互',
    summary: '客户端入口和结果页。',
    content: '## 关键流程\n\n1. 玩家点击入口\n2. 拉取活动状态\n3. 展示结果页\n\n> 弱网时要有明确反馈。',
    type: 'module',
    status: 'pending',
    level: 1,
    order: 0,
    needsPolish: false,
    extractedFrom: '## 客户端',
    techNotes: '`UIState` 包含 loading、ready、error。',
    children: ['ENTRY'],
    docPath: 'client/README.md',
    audience: 'client',
    handoffGoal: '交给客户端 AI 打磨。',
    qualityGate: '状态覆盖完整。',
  },
  SERVER: {
    id: 'SERVER',
    parentId: 'ROOT',
    label: '服务端接口',
    summary: '接口和结算。',
    content: '## API 清单\n\n- `POST /activity/join`\n- `POST /activity/claim`\n\n| 字段 | 说明 |\n| --- | --- |\n| requestId | 幂等键 |',
    type: 'feature',
    status: 'pending',
    level: 1,
    order: 1,
    needsPolish: false,
    extractedFrom: '## 服务端',
    techNotes: null,
    children: [],
    docPath: 'server/api.md',
    audience: 'api',
    handoffGoal: '生成接口明细。',
    qualityGate: '错误码明确。',
  },
  ENTRY: {
    id: 'ENTRY',
    parentId: 'CLIENT',
    label: '活动入口与引导',
    summary: '入口红点、引导和动效。',
    content: '## 入口状态\n\n- 未开启：入口置灰\n- 可参与：入口高亮\n- 已完成：显示已领取\n\n### 动效\n播放 `ActivityOpenTimeline`。',
    type: 'ui',
    status: 'pending',
    level: 2,
    order: 0,
    needsPolish: true,
    extractedFrom: '### 活动入口',
    techNotes: null,
    children: [],
    docPath: 'client/activity-entry.md',
    audience: 'client',
    handoffGoal: '打磨入口交互。',
    qualityGate: '三个状态都有视觉反馈。',
  },
}

const markdownContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
await markdownContext.addInitScript((treeArg) => {
  localStorage.setItem('gameux-promptforge-state', JSON.stringify({
    state: {
      requirement: {
        trigger_condition: null,
        sequence_rules: null,
        asset_dependencies: [],
        engine_constraints: null,
        ui_components: [],
        suggested_answers: [],
        completion_rate: 0,
        slot_confidence: { trigger_condition: 0, sequence_rules: 0, asset_dependencies: 0, engine_constraints: 0 },
        missing_reasons: { trigger_condition: null, sequence_rules: null, asset_dependencies: null, engine_constraints: null },
        next_question: null,
      },
      messages: [],
      latestRag: null,
      prototypeHtml: null,
      prototypeHistory: [],
      settings: { projectName: 'GameUX PromptForge', proxyBaseUrl: 'http://127.0.0.1:8787', defaultRagQuery: '' },
      prdTree: treeArg,
      selectedNodeId: null,
      nodeChats: {},
    },
    version: 7,
  }))
}, tree)

const markdownPage = await markdownContext.newPage()
await markdownPage.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await markdownPage.waitForFunction(() => document.querySelectorAll('[data-node-card="true"]').length >= 4, null, { timeout: 10000 })
await shot('e2e-04-markdown-card-preview.png', markdownPage)

const markdownChecks = await markdownPage.evaluate(() => ({
  cardCount: document.querySelectorAll('[data-node-card="true"]').length,
  lineCount: document.querySelectorAll('.svg-line').length,
  hasHeading: document.body.textContent?.includes('关键流程') ?? false,
  hasBullet: document.body.textContent?.includes('未开启') ?? false,
  hasInlineCode: document.body.textContent?.includes('POST /activity/join') ?? false,
  hasPreviewLabel: document.body.textContent?.includes('文档预览') ?? false,
  lineAnimations: [...document.querySelectorAll('.svg-line')].map((el) => getComputedStyle(el).animationName),
}))

await browser.close()
await fs.writeFile(
  path.join(artifactDir, 'e2e-results.json'),
  JSON.stringify({ uploadFlow, markdownChecks, screenshots }, null, 2),
  'utf8',
)

console.log(JSON.stringify({ uploadFlow, markdownChecks, screenshots }, null, 2))
