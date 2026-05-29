const TAILWIND_CDN = 'https://cdn.tailwindcss.com'

function stripFrontmatter(input: string) {
  return input.replace(/^---[\s\S]*?---\s*/u, '').trim()
}

function extractFencedCode(input: string) {
  const preferred = input.match(/```(?:html|HTML)\s*([\s\S]*?)```/u)
  if (preferred?.[1]) return preferred[1].trim()

  const generic = input.match(/```\s*([\s\S]*?)```/u)
  if (generic?.[1] && /<\/?[a-z][\s\S]*>/iu.test(generic[1])) return generic[1].trim()

  return null
}

function extractHtmlDocument(input: string) {
  const docStart = input.search(/<!doctype\s+html|<html[\s>]/iu)
  if (docStart >= 0) {
    const doc = input.slice(docStart)
    const docEnd = doc.search(/<\/html>/iu)
    return docEnd >= 0 ? doc.slice(0, docEnd + '</html>'.length).trim() : doc.trim()
  }

  const bodyLikeStart = input.search(/<(body|main|section|div|canvas|script|style|head)[\s>]/iu)
  if (bodyLikeStart >= 0) return input.slice(bodyLikeStart).trim()

  return input.trim()
}

function hasTailwind(html: string) {
  return /cdn\.tailwindcss\.com|tailwind\.min\.css/iu.test(html)
}

function hasViewport(html: string) {
  return /<meta[^>]+name=["']viewport["']/iu.test(html)
}

function injectIntoHead(html: string, snippet: string) {
  if (/<\/head>/iu.test(html)) {
    return html.replace(/<\/head>/iu, `${snippet}\n</head>`)
  }
  if (/<html[\s>]/iu.test(html)) {
    return html.replace(/<html([^>]*)>/iu, `<html$1>\n<head>\n${snippet}\n</head>`)
  }
  return snippet + '\n' + html
}

export function parsePrototypeMarkdown(raw: string) {
  const stripped = stripFrontmatter(raw)
  const fenced = extractFencedCode(stripped)
  return extractHtmlDocument(fenced ?? stripped)
}

export function normalizePrototypeHtml(raw: string) {
  const parsed = parsePrototypeMarkdown(raw)
  const isFullDocument = /<!doctype\s+html|<html[\s>]/iu.test(parsed)
  const viewport = hasViewport(parsed)
    ? ''
    : '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
  const tailwind = hasTailwind(parsed)
    ? ''
    : `<script src="${TAILWIND_CDN}"></script>`
  const storageShim = `<script>
  (() => {
    const createMemoryStorage = () => {
      const store = new Map();
      return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (key) => store.has(String(key)) ? store.get(String(key)) : null,
        key: (index) => Array.from(store.keys())[index] ?? null,
        removeItem: (key) => store.delete(String(key)),
        setItem: (key, value) => { store.set(String(key), String(value)); }
      };
    };
    for (const name of ['localStorage', 'sessionStorage']) {
      const memoryStorage = createMemoryStorage();
      try { Object.defineProperty(window, name, { get: () => memoryStorage, configurable: true }); } catch {}
      try { Object.defineProperty(Window.prototype, name, { get: () => memoryStorage, configurable: true }); } catch {}
    }
  })();
</script>`
  const baseStyle = `<style>
  html, body { margin: 0; min-height: 100%; background: #05070d; color: #f7f7fb; }
  * { box-sizing: border-box; }
  button, input, textarea, select { font: inherit; }
</style>`
  const headAdditions = [viewport, storageShim, tailwind, baseStyle].filter(Boolean).join('\n')

  if (isFullDocument) {
    return injectIntoHead(parsed, headAdditions).trim()
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
${headAdditions}
<title>GameUX Prototype</title>
</head>
<body>
${parsed}
</body>
</html>`.trim()
}

export function applyPrototypeEdit(html: string, oldString: string, newString: string) {
  if (!oldString) return { html, applied: false }
  const index = html.indexOf(oldString)
  if (index < 0) return { html, applied: false }
  return {
    html: html.slice(0, index) + newString + html.slice(index + oldString.length),
    applied: true,
  }
}

export function formatPrototypeVersionTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
