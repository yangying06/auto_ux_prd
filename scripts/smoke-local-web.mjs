const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 160)}`)
  }
  return text
}

async function postBinary(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const bytes = await response.arrayBuffer()
  if (!response.ok) {
    const text = new TextDecoder().decode(bytes)
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 160)}`)
  }
  return { response, bytes }
}

async function fetchJson(path) {
  const text = await fetchText(path)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${path} did not return JSON: ${text.slice(0, 160)}`)
  }
}

function extractAssetPaths(text) {
  const paths = new Set()
  for (const match of text.matchAll(/["'`(](\/assets\/[^"'`()\s<>]+?\.(?:js|css))/g)) {
    paths.add(match[1])
  }
  for (const match of text.matchAll(/["'`](assets\/[^"'`()\s<>]+?\.(?:js|css))/g)) {
    paths.add(`/${match[1]}`)
  }
  return paths
}

async function verifyBuiltAssets(rootHtml) {
  const pending = [...extractAssetPaths(rootHtml)]
  const visited = new Set()

  while (pending.length > 0) {
    const path = pending.shift()
    if (!path || visited.has(path)) continue
    visited.add(path)

    const content = await fetchText(path)
    if (path.endsWith('.js')) {
      for (const nestedPath of extractAssetPaths(content)) {
        if (!visited.has(nestedPath)) pending.push(nestedPath)
      }
    }
  }

  if (visited.size === 0) {
    throw new Error('root HTML did not expose any built asset paths')
  }
  if (![...visited].some((path) => /(?:MapPage|ForgePage|QaPage)-/.test(path))) {
    throw new Error('built assets did not expose expected lazy route chunks')
  }
}

const health = await fetchJson('/api/health')
if (health?.ok !== true) {
  throw new Error('/api/health did not report ok=true')
}

const root = await fetchText('/')
if (!root.includes('/assets/')) {
  throw new Error('root HTML does not reference built /assets/ chunks')
}
await verifyBuiltAssets(root)

const sandbox = await fetchText('/sandbox.html')
if (!sandbox.includes('Prototype content')) {
  throw new Error('/sandbox.html did not return the prototype sandbox')
}

const spineCss = await fetchText('/api/runtime/spine-player/spine-player.css')
if (!spineCss.includes('spine-player')) {
  throw new Error('Spine runtime CSS did not look like the expected asset')
}

const smokeTree = {
  ROOT: {
    id: 'ROOT',
    label: 'Root',
    summary: 'Smoke root',
    content: 'Smoke root content',
    type: 'module',
    status: 'done',
    level: 0,
    order: 0,
    needsPolish: false,
    parentId: null,
    children: ['PAGE-SMOKE'],
    references: [],
  },
  'PAGE-SMOKE': {
    id: 'PAGE-SMOKE',
    label: 'Smoke Page',
    summary: 'Smoke export page',
    content: 'Smoke export content',
    type: 'page',
    status: 'done',
    level: 1,
    order: 0,
    needsPolish: true,
    parentId: 'ROOT',
    children: [],
    references: [],
  },
}

const exportZip = await postBinary('/api/export-zip', { tree: smokeTree })
const disposition = exportZip.response.headers.get('content-disposition') || ''
if (!disposition.includes('spec-export.zip') || exportZip.bytes.byteLength < 100) {
  throw new Error('/api/export-zip did not return the expected zip download response')
}

console.log(`local web smoke passed: ${baseUrl}`)
