import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = process.cwd()

async function collectTestFiles(dirs) {
  const results = []
  for (const dir of dirs) {
    const stack = [dir]
    while (stack.length) {
      const current = stack.pop()
      let entries
      try { entries = await readdir(current, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.claude') continue
        const full = join(current, entry.name)
        if (entry.isDirectory()) { stack.push(full); continue }
        if (entry.isFile() && entry.name.endsWith('.test.ts')) results.push(full)
      }
    }
  }
  return results.sort()
}

function runOne(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.stdout.on('data', () => {})
    child.on('close', (code) => resolve({ file, code, stderr }))
  })
}

async function main() {
  const files = await collectTestFiles(['server', 'src'])
  if (files.length === 0) {
    console.error('No test files found.')
    process.exit(1)
  }

  const failures = []
  for (const file of files) {
    const short = relative(root, file)
    const result = await runOne(file)
    if (result.code === 0) {
      console.log('  pass  ' + short)
    } else {
      console.error('  FAIL  ' + short)
      failures.push({ file: short, stderr: result.stderr })
    }
  }

  console.error('')
  const passed = files.length - failures.length
  console.error(passed + '/' + files.length + ' test files passed')
  if (failures.length) {
    console.error('')
    for (const item of failures) {
      console.error('--- ' + item.file + ' ---')
      console.error(item.stderr.trim().split('\n').slice(-12).join('\n'))
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
