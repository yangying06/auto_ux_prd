import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectProjectPlatforms, deriveIterationQueryTerms, scanProjectBaseline } from './projectBaselineScan'

function writeFile(root: string, relativePath: string, body: string) {
  const absolutePath = path.join(root, relativePath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, body, 'utf8')
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'promptforge-baseline-'))

try {
  const h5Root = path.join(tempRoot, 'h5-client')
  writeFile(h5Root, 'package.json', '{"scripts":{"dev":"vite"}}')
  writeFile(h5Root, 'src/pages/HelpPage.tsx', 'export function HelpPage(){ return <TaskHelp mission="daily" /> }')
  writeFile(h5Root, 'src/components/TaskHelp.tsx', 'export function TaskHelp(){ return <section>任务说明 help tips</section> }')
  writeFile(h5Root, 'src/pages/ShopPage.tsx', 'export function ShopPage(){ return <div>shop</div> }')

  const h5Scan = scanProjectBaseline({
    rootPath: h5Root,
    iterationPrd: '迭代帮助界面上的任务说明功能，需要调整 help task tips 展示。',
    focus: '帮助界面 任务说明',
  })
  assert.equal(h5Scan.policy.fullProjectRead, false, 'scan policy must keep full project read disabled')
  assert.equal(h5Scan.platforms[0].platform, 'h5', 'H5 project should be detected from package/routes/components')
  assert.ok(h5Scan.queryTerms.includes('帮助界面') || h5Scan.queryTerms.includes('帮助'), 'Chinese PRD focus terms should be derived')
  assert.ok(
    h5Scan.evidence.some((item) => item.relativePath === 'src/pages/HelpPage.tsx'),
    'targeted scan should recall the help page evidence',
  )
  assert.ok(
    h5Scan.evidence.every((item) => !item.relativePath.includes('node_modules')),
    'ignored directories should not appear as evidence',
  )

  const androidRoot = path.join(tempRoot, 'android-client')
  writeFile(androidRoot, 'settings.gradle', 'pluginManagement {}')
  writeFile(androidRoot, 'app/src/main/AndroidManifest.xml', '<manifest />')
  writeFile(androidRoot, 'app/src/main/res/layout/activity_help.xml', '<TextView android:text="@string/task_help" />')
  assert.equal(detectProjectPlatforms(androidRoot)[0].platform, 'android', 'Android markers should be detected')

  const iosRoot = path.join(tempRoot, 'ios-client')
  writeFile(iosRoot, 'Game.xcodeproj/project.pbxproj', '// xcode project')
  writeFile(iosRoot, 'HelpViewController.swift', 'final class HelpViewController {}')
  assert.equal(detectProjectPlatforms(iosRoot)[0].platform, 'ios', 'iOS markers should be detected')

  const cocosRoot = path.join(tempRoot, 'cocos-client')
  writeFile(cocosRoot, 'project.json', '{"engine":"cocos"}')
  writeFile(cocosRoot, 'assets/scenes/help.scene', '{"name":"Help"}')
  assert.equal(detectProjectPlatforms(cocosRoot)[0].platform, 'cocos', 'Cocos markers should be detected')

  const unityRoot = path.join(tempRoot, 'unity-client')
  writeFile(unityRoot, 'ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 2022.3')
  writeFile(unityRoot, 'Assets/Scenes/Help.unity', '%YAML 1.1')
  assert.equal(detectProjectPlatforms(unityRoot)[0].platform, 'unity', 'Unity markers should be detected')

  const terms = deriveIterationQueryTerms('帮助界面新增任务说明 help task')
  assert.ok(terms.includes('help') && terms.includes('task'), 'English PRD terms should be preserved')

  console.log('projectBaselineScan.test.ts: all assertions passed')
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
