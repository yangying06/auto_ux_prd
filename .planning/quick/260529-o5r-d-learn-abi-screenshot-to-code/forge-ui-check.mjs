import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('D:/npm-global/node_modules/dev-browser/node_modules/playwright')

const artifactDir = 'D:/learn/auto_ux_prd/.planning/quick/260529-o5r-d-learn-abi-screenshot-to-code'
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const tree = {
  ROOT: {
    id: 'ROOT', parentId: null, label: '测试 PRD', summary: '根文档', content: '## 总览\n\n用于验证打磨界面。', type: 'module', status: 'pending', level: 0, order: 0, needsPolish: false, extractedFrom: null, techNotes: null, children: ['ENTRY'], docPath: 'README.md', audience: 'overview', handoffGoal: '索引入口', qualityGate: '可访问'
  },
  ENTRY: {
    id: 'ENTRY', parentId: 'ROOT', label: '活动入口与引导', summary: '入口红点、引导和动效。', content: '## 入口状态\n\n- 未开启：入口置灰\n- 可参与：入口高亮\n- 已完成：显示已领取\n\n### 动效\n播放 `ActivityOpenTimeline`。', type: 'ui', status: 'pending', level: 1, order: 0, needsPolish: true, extractedFrom: '### 活动入口', techNotes: '面向 Cocos Creator 长屏手机 UI。', children: [], docPath: 'client/activity-entry.md', audience: 'client', handoffGoal: '打磨入口交互。', qualityGate: '三个状态都有视觉反馈。'
  }
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await context.addInitScript((treeArg) => {
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

const page = await context.newPage()
await page.goto('http://127.0.0.1:5173/#/forge/ENTRY', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.textContent?.includes('视觉舱'), null, { timeout: 10000 })
await page.screenshot({ path: path.join(artifactDir, 'forge-ui-check.png'), fullPage: false })

const checks = await page.evaluate(() => {
  const text = document.body.textContent ?? ''
  const activePrototype = [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('原型') && getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)')
  const visualPane = [...document.querySelectorAll('aside')].at(-1)?.getBoundingClientRect()
  return {
    hasVisualPane: text.includes('视觉舱'),
    hasPrototypeTab: text.includes('原型'),
    hasReferenceTab: text.includes('参考图'),
    hasCompareTab: text.includes('对比'),
    hasPrototypePlaceholder: text.includes('750 × 1624 手机预览将在此生成。'),
    activePrototype,
    visualPaneWidth: Math.round(visualPane?.width ?? 0),
  }
})

await browser.close()
await fs.writeFile(path.join(artifactDir, 'forge-ui-check.json'), JSON.stringify(checks, null, 2), 'utf8')
console.log(JSON.stringify(checks, null, 2))
