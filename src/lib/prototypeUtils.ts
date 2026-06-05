const TAILWIND_CDN = 'https://cdn.tailwindcss.com'
export const PROTOTYPE_DESIGN_WIDTH = 375
export const PROTOTYPE_DESIGN_HEIGHT = 812

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

function extractFileContent(input: string) {
  const file = input.match(/<file\s+path=["'][^"']+["']>\s*([\s\S]*?)\s*<\/file>/iu)
  return file?.[1]?.trim() ?? null
}

export function extractPrototypeHtmlContent(input: string): string | null {
  const stripped = stripFrontmatter(input)
  const fileContent = extractFileContent(stripped)
  if (fileContent) {
    const extractedFromFile = extractPrototypeHtmlContent(fileContent)
    if (extractedFromFile) return extractedFromFile
  }

  const fenced = extractFencedCode(stripped)
  const candidates = [fileContent, fenced, stripped].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    const withoutOuterFence = candidate
      .replace(/^```html?\s*\n?/imu, '')
      .replace(/\n?```\s*$/imu, '')
      .trim()

    const matchWithDoctype = withoutOuterFence.match(/(<!doctype\s+html[^>]*>\s*<html[\s\S]*?<\/html>)/iu)
    if (matchWithDoctype?.[1]) return matchWithDoctype[1].trim()

    const match = withoutOuterFence.match(/(<html[\s\S]*?<\/html>)/iu)
    if (match?.[1]) return match[1].trim()
  }

  return null
}

function extractHtmlFragmentOrText(input: string) {
  const fileContent = extractFileContent(input)
  const candidate = fileContent ?? input
  const docStart = candidate.search(/<!doctype\s+html|<html[\s>]/iu)
  if (docStart >= 0) {
    const doc = candidate.slice(docStart)
    const docEnd = doc.search(/<\/html>/iu)
    return docEnd >= 0 ? doc.slice(0, docEnd + '</html>'.length).trim() : doc.trim()
  }

  const bodyLikeStart = candidate.search(/<(body|main|section|div|canvas|script|style|head)[\s>]/iu)
  if (bodyLikeStart >= 0) return candidate.slice(bodyLikeStart).trim()

  return candidate.trim()
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
  const completeHtml = extractPrototypeHtmlContent(stripped)
  if (completeHtml) return completeHtml

  const fenced = extractFencedCode(stripped)
  return extractHtmlFragmentOrText(fenced ?? stripped)
}

export function normalizeGeneratedPrototypeHtml(raw: string) {
  const completeHtml = extractPrototypeHtmlContent(raw)
  return completeHtml ? normalizePrototypeHtml(completeHtml) : null
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
  :root { --prototype-design-width: 375px; }
  html, body { margin: 0; width: 100%; min-width: var(--prototype-design-width); min-height: 100vh; overflow-x: hidden; overflow-y: auto; background: #05070d; color: #f7f7fb; }
  body { display: block !important; position: relative; }
  *, html, body { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar, html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
  body > :not(script):not(style):not(link):not(meta),
  #root,
  #app,
  body > main,
  body > .app,
  body > .prototype-root,
  body > .game-container,
  body > .mobile-container,
  body > .phone-container,
  body > .screen-container,
  body > .phone,
  body > .screen,
  #root > main,
  #root > .app,
  #root > .prototype-root,
  #root > .game-container,
  #root > .mobile-container,
  #root > .phone-container,
  #root > .screen-container,
  #root > .phone,
  #root > .screen,
  #app > main,
  #app > .app,
  #app > .prototype-root,
  #app > .game-container,
  #app > .mobile-container,
  #app > .phone-container,
  #app > .screen-container,
  #app > .phone,
  #app > .screen,
  body > [class*="w-[320"],
  body > [class*="w-[360"],
  body > [class*="w-[375"],
  body > [class*="w-[390"],
  body > [class*="w-[393"],
  body > [class*="w-[414"],
  body > [class*="max-w-"],
  body > [class*="mx-auto"],
  #root > [class*="w-[320"],
  #root > [class*="w-[360"],
  #root > [class*="w-[375"],
  #root > [class*="w-[390"],
  #root > [class*="w-[393"],
  #root > [class*="w-[414"],
  #root > [class*="max-w-"],
  #root > [class*="mx-auto"],
  #app > [class*="w-[320"],
  #app > [class*="w-[360"],
  #app > [class*="w-[375"],
  #app > [class*="w-[390"],
  #app > [class*="w-[393"],
  #app > [class*="w-[414"],
  #app > [class*="max-w-"],
  #app > [class*="mx-auto"] {
    width: 100vw !important;
    max-width: none !important;
    min-width: var(--prototype-design-width) !important;
  }
  body > :not(script):not(style):not(link):not(meta),
  #root,
  #app,
  body > main,
  body > .prototype-root,
  #root > main,
  #root > .prototype-root,
  #app > main,
  #app > .prototype-root {
    min-height: 100vh !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
  body * { max-width: 100vw; }
  img, svg, canvas, video { max-width: 100%; }
  * { box-sizing: border-box; }
  button, input, textarea, select { font: inherit; }
</style>`
  const fitRootScript = `<script>
  (() => {
    const fitRoots = () => {
      const candidates = [
        ...document.querySelectorAll('body > :not(script):not(style):not(link):not(meta), body > :not(script):not(style):not(link):not(meta) > *, #root, #app, #root > *, #app > *, main')
      ];
      const seen = new Set();
      for (const el of candidates) {
        if (!(el instanceof HTMLElement) || seen.has(el)) continue;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const tooNarrow = rect.height >= window.innerHeight * 0.55 && rect.width < window.innerWidth * 0.96;
        const tooWide = rect.width > window.innerWidth + 1 || rect.right > window.innerWidth + 1 || rect.left < -1;
        if (!tooNarrow && !tooWide) continue;
        el.style.width = '100vw';
        el.style.maxWidth = 'none';
        el.style.minWidth = 'var(--prototype-design-width)';
        el.style.marginLeft = '0';
        el.style.marginRight = '0';
        if (Math.abs(rect.left) > 1) el.style.left = '0';
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      }
    };
    requestAnimationFrame(fitRoots);
    window.addEventListener('load', fitRoots);
    setTimeout(fitRoots, 120);
    setTimeout(fitRoots, 500);
  })();
</script>`
  const headAdditions = [viewport, storageShim, tailwind, baseStyle, fitRootScript].filter(Boolean).join('\n')

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
