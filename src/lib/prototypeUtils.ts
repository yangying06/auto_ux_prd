const TAILWIND_CDN = 'https://cdn.tailwindcss.com'
export const PROTOTYPE_DESIGN_WIDTH = 375
export const PROTOTYPE_DESIGN_HEIGHT = 812

const PROTOTYPE_ANNOTATION_STRIP_STYLE = `<style>
  [data-prototype-annotation],
  [data-annotation],
  [data-ux-annotation],
  [data-role="annotation"],
  .prototype-annotation,
  .prototype-callout,
  .prototype-note,
  .component-annotation,
  .component-label,
  .component-note,
  .hotspot-label,
  .hint-label,
  .interaction-note,
  .spec-annotation,
  .spec-label,
  .spec-note,
  .ui-annotation,
  .ui-callout,
  .ui-note,
  .ux-annotation,
  .ux-callout,
  .ux-note,
  .annotation,
  .annot,
  .callout,
  .tooltip {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
</style>`

const PROTOTYPE_ANNOTATION_STRIP_SCRIPT = `<script>
  (() => {
    const stripAnnotationSelector = [
      '[data-prototype-annotation]',
      '[data-annotation]',
      '[data-ux-annotation]',
      '[data-role="annotation"]',
      '[data-prototype-externalized-annotation]',
      '#__prototype_annotation_guides',
      '.prototype-annotation',
      '.prototype-callout',
      '.prototype-note',
      '.component-annotation',
      '.component-label',
      '.component-note',
      '.hotspot-label',
      '.hint-label',
      '.interaction-note',
      '.spec-annotation',
      '.spec-label',
      '.spec-note',
      '.ui-annotation',
      '.ui-callout',
      '.ui-note',
      '.ux-annotation',
      '.ux-callout',
      '.ux-note',
      '.annotation',
      '.annot',
      '.callout',
      '.tooltip'
    ].join(',');
    const stripAnnotationTextPattern = /^(?:组件|状态|动效|动画|参数|说明|注释|标注|提示)\\s*[:：]/;
    const stripInteractiveSelector = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      'summary',
      'label',
      '[contenteditable="true"]',
      '[onclick]',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="switch"]',
      '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const removePrototypeAnnotations = () => {
      document.documentElement.classList.remove('prototype-annotations-externalized');
      document.body?.classList.remove('prototype-annotations-externalized');
      for (const name of [
        '--prototype-annotation-total-width',
        '--prototype-annotation-screen-offset',
        '--prototype-annotation-left-rail-left',
        '--prototype-annotation-right-rail-left',
        '--prototype-annotation-rail-width'
      ]) {
        document.documentElement.style.removeProperty(name);
      }
      for (const el of Array.from(document.querySelectorAll(stripAnnotationSelector))) {
        el.remove();
      }
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.matches(stripInteractiveSelector) || el.closest(stripInteractiveSelector) || el.querySelector(stripInteractiveSelector)) continue;
        const text = (el.textContent || '').trim();
        const rect = el.getBoundingClientRect();
        const isCompact = rect.width > 0 && rect.height > 0 && rect.width <= 240 && rect.height <= 64;
        if (isCompact && stripAnnotationTextPattern.test(text)) el.remove();
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', removePrototypeAnnotations, { once: true });
    } else {
      removePrototypeAnnotations();
    }
    window.addEventListener('load', removePrototypeAnnotations);
    requestAnimationFrame(removePrototypeAnnotations);
    setTimeout(removePrototypeAnnotations, 120);
    setTimeout(removePrototypeAnnotations, 500);
    return;
    const annotationMarkerPattern = /(^|[-_\\s])(?:annotation|annot|callout|tooltip|hint|hotspot-label|component[-_\\s]?(?:annotation|label|note|tag)|interaction[-_\\s]?note|prototype[-_\\s]?(?:annotation|callout|note)|spec[-_\\s]?(?:annotation|label|note|tag)|ui[-_\\s]?(?:annotation|callout|note)|ux[-_\\s]?(?:annotation|callout|note))($|[-_\\s])/i;
    const annotationTextPattern = /^(?:组件|状态|动效|动画|参数|说明|注释|标注|提示)\\s*[:：]/;
    const annotationSelector = [
      '[data-prototype-annotation]',
      '[data-annotation]',
      '[data-ux-annotation]',
      '[data-role="annotation"]',
      '.prototype-annotation',
      '.prototype-callout',
      '.prototype-note',
      '.component-annotation',
      '.component-label',
      '.component-note',
      '.hotspot-label',
      '.hint-label',
      '.interaction-note',
      '.spec-annotation',
      '.spec-label',
      '.spec-note',
      '.ui-annotation',
      '.ui-callout',
      '.ui-note',
      '.ux-annotation',
      '.ux-callout',
      '.ux-note',
      '.annotation',
      '.annot',
      '.callout',
      '.tooltip'
    ].join(',');
    const interactiveSelector = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      'summary',
      'label',
      '[contenteditable="true"]',
      '[onclick]',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="switch"]',
      '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const toFiniteNumber = (value) => {
      const number = Number.parseFloat(String(value ?? ''));
      return Number.isFinite(number) ? number : null;
    };

    const readMarkers = (el) => [
      el.id,
      String(el.className || ''),
      el.getAttribute('data-prototype-annotation'),
      el.getAttribute('data-annotation'),
      el.getAttribute('data-ux-annotation'),
      el.getAttribute('data-role'),
      el.getAttribute('aria-label'),
      el.getAttribute('title')
    ].filter(Boolean).join(' ');

    const hasInteractiveRole = (el) => (
      el.matches(interactiveSelector)
      || Boolean(el.closest(interactiveSelector))
      || Boolean(el.querySelector(interactiveSelector))
    );

    const isLikelyOverlayAnnotation = (el) => {
      if (!(el instanceof HTMLElement) || el.id === '__prototype_annotation_guides' || hasInteractiveRole(el)) return false;
      const markers = readMarkers(el);
      const text = (el.textContent || '').trim();
      const hasAnnotationMarker = el.matches(annotationSelector) || annotationMarkerPattern.test(markers);
      if (!hasAnnotationMarker && !annotationTextPattern.test(text)) return false;

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hasAnchor = toFiniteNumber(el.getAttribute('data-anchor-x') ?? el.getAttribute('data-target-x')) !== null
        && toFiniteNumber(el.getAttribute('data-anchor-y') ?? el.getAttribute('data-target-y')) !== null;
      const isOverlay = style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky' || style.zIndex !== 'auto';
      const isCompact = rect.width > 0 && rect.height > 0 && rect.width <= 220 && rect.height <= 48;
      return hasAnnotationMarker || hasAnchor || isOverlay || isCompact;
    };

    const resolveScreenWidth = () => {
      const cssWidth = toFiniteNumber(window.getComputedStyle(document.documentElement).getPropertyValue('--prototype-design-width'));
      if (cssWidth) return cssWidth;
      const stage = document.querySelector('.pf-shell, [data-prototype-screen], .prototype-root, .game-container, .mobile-container, .phone-container, .screen-container, .phone, .screen, main, #root > *, #app > *');
      const rect = stage instanceof HTMLElement ? stage.getBoundingClientRect() : null;
      if (rect && rect.width > 0) return Math.round(rect.width);
      return 375;
    };

    const resolveAnchor = (el, fallbackRect, screenWidth) => {
      const currentScreenOffset = toFiniteNumber(window.getComputedStyle(document.documentElement).getPropertyValue('--prototype-annotation-screen-offset')) ?? 0;
      const selector = el.getAttribute('data-target-selector');
      if (selector) {
        try {
          const target = document.querySelector(selector);
          if (target instanceof HTMLElement || target instanceof SVGElement) {
            const rect = target.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
              return {
                x: clamp(rect.left + window.scrollX + rect.width / 2 - currentScreenOffset, 8, screenWidth - 8),
                y: Math.max(8, rect.top + window.scrollY + rect.height / 2)
              };
            }
          }
        } catch {}
      }

      const attrX = toFiniteNumber(el.getAttribute('data-anchor-x') ?? el.getAttribute('data-target-x'));
      const attrY = toFiniteNumber(el.getAttribute('data-anchor-y') ?? el.getAttribute('data-target-y'));
      if (attrX !== null && attrY !== null) {
        return {
          x: clamp(attrX, 8, screenWidth - 8),
          y: Math.max(8, attrY)
        };
      }

      return {
        x: clamp(fallbackRect.left + window.scrollX + fallbackRect.width / 2 - currentScreenOffset, 8, screenWidth - 8),
        y: Math.max(8, fallbackRect.top + window.scrollY + fallbackRect.height / 2)
      };
    };

    const ensureGuideLayer = (width, height) => {
      let layer = document.getElementById('__prototype_annotation_guides');
      if (!(layer instanceof SVGSVGElement)) {
        layer = document.createElementNS(SVG_NS, 'svg');
        layer.id = '__prototype_annotation_guides';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
      }
      layer.setAttribute('width', String(width));
      layer.setAttribute('height', String(height));
      layer.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      layer.style.width = width + 'px';
      layer.style.height = height + 'px';
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      return layer;
    };

    const drawLeader = (layer, screenLeft, screenWidth, entry, railWidth) => {
      const anchor = {
        x: screenLeft + entry.anchor.x,
        y: entry.anchor.y
      };
      const labelMidY = entry.top + entry.height / 2;
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(anchor.x));
      dot.setAttribute('cy', String(anchor.y));
      dot.setAttribute('r', '3.5');
      dot.setAttribute('data-prototype-leader-dot', 'true');

      const path = document.createElementNS(SVG_NS, 'path');
      if (entry.side === 'left') {
        const labelEdgeX = entry.labelLeft + railWidth + 8;
        const elbowX = Math.min(screenLeft - 10, entry.labelLeft + railWidth + 28);
        path.setAttribute('d', 'M ' + anchor.x + ' ' + anchor.y + ' C ' + elbowX + ' ' + anchor.y + ', ' + elbowX + ' ' + labelMidY + ', ' + labelEdgeX + ' ' + labelMidY);
      } else {
        const labelEdgeX = entry.labelLeft - 8;
        const elbowX = Math.max(screenLeft + screenWidth + 10, entry.labelLeft - 28);
        path.setAttribute('d', 'M ' + anchor.x + ' ' + anchor.y + ' C ' + elbowX + ' ' + anchor.y + ', ' + elbowX + ' ' + labelMidY + ', ' + labelEdgeX + ' ' + labelMidY);
      }
      path.setAttribute('data-prototype-leader-line', 'true');

      layer.appendChild(path);
      layer.appendChild(dot);
    };

    const externalizeAnnotations = () => {
      if (!document.body) return;
      const candidates = Array.from(document.querySelectorAll('body *')).filter((el) => isLikelyOverlayAnnotation(el));
      if (!candidates.length) return;

      const screenWidth = resolveScreenWidth();
      const railGap = 24;
      const railWidth = 220;
      const outerMargin = 12;

      const normalizeSide = (value, anchorX) => {
        const text = String(value ?? '').trim().toLowerCase();
        if (text === 'left' || text === 'right') return text;
        return anchorX <= screenWidth / 2 ? 'left' : 'right';
      };

      const entries = [];
      for (const el of candidates) {
        if (!(el instanceof HTMLElement)) continue;
        const fallbackRect = el.getBoundingClientRect();
        if (!el.dataset.prototypeAnnotationAnchorX || !el.dataset.prototypeAnnotationAnchorY) {
          const anchor = resolveAnchor(el, fallbackRect, screenWidth);
          el.dataset.prototypeAnnotationAnchorX = String(anchor.x);
          el.dataset.prototypeAnnotationAnchorY = String(anchor.y);
        }
        const anchor = {
          x: toFiniteNumber(el.dataset.prototypeAnnotationAnchorX) ?? 8,
          y: toFiniteNumber(el.dataset.prototypeAnnotationAnchorY) ?? 8
        };
        const side = normalizeSide(el.getAttribute('data-annotation-side') ?? el.getAttribute('data-callout-side'), anchor.x);

        if (el.parentElement !== document.body) document.body.appendChild(el);
        el.setAttribute('data-prototype-externalized-annotation', 'true');
        el.setAttribute('data-prototype-annotation-side', side);
        el.setAttribute('data-prototype-nonblocking-annotation', 'true');
        el.style.left = '0px';
        el.style.top = '0px';
        el.style.width = railWidth + 'px';
        el.style.pointerEvents = 'none';

        const measured = el.getBoundingClientRect();
        entries.push({
          el,
          anchor,
          side,
          labelLeft: 0,
          top: 0,
          height: Math.max(24, Math.ceil(measured.height || fallbackRect.height || 24))
        });
      }

      const hasLeftRail = entries.some((entry) => entry.side === 'left');
      const hasRightRail = entries.some((entry) => entry.side === 'right');
      const leftRailLeft = outerMargin;
      const screenLeft = hasLeftRail ? outerMargin + railWidth + railGap : 0;
      const rightRailLeft = screenLeft + screenWidth + railGap;
      const totalWidth = screenLeft + screenWidth + (hasRightRail ? railGap + railWidth + outerMargin : 0);

      document.documentElement.classList.add('prototype-annotations-externalized');
      document.body.classList.add('prototype-annotations-externalized');
      document.documentElement.style.setProperty('--prototype-design-width', screenWidth + 'px');
      document.documentElement.style.setProperty('--prototype-annotation-total-width', totalWidth + 'px');
      document.documentElement.style.setProperty('--prototype-annotation-screen-offset', screenLeft + 'px');
      document.documentElement.style.setProperty('--prototype-annotation-left-rail-left', leftRailLeft + 'px');
      document.documentElement.style.setProperty('--prototype-annotation-right-rail-left', rightRailLeft + 'px');
      document.documentElement.style.setProperty('--prototype-annotation-rail-width', railWidth + 'px');
      document.body.style.minWidth = totalWidth + 'px';

      const layoutSide = (side, railLeft) => {
        const sideEntries = entries
          .filter((entry) => entry.side === side)
          .sort((a, b) => a.anchor.y - b.anchor.y);
        let nextTop = 12;
        for (const entry of sideEntries) {
          const desiredTop = Math.max(12, entry.anchor.y - entry.height / 2);
          const top = Math.max(desiredTop, nextTop);
          entry.el.style.left = railLeft + 'px';
          entry.el.style.top = top + 'px';
          entry.labelLeft = railLeft;
          entry.top = top;
          nextTop = top + entry.height + 10;
        }
        return nextTop;
      };

      const leftBottom = hasLeftRail ? layoutSide('left', leftRailLeft) : 12;
      const rightBottom = hasRightRail ? layoutSide('right', rightRailLeft) : 12;

      const contentHeight = Math.ceil(Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        window.innerHeight,
        leftBottom + 16,
        rightBottom + 16
      ));
      const layer = ensureGuideLayer(totalWidth, contentHeight);
      for (const entry of entries) {
        drawLeader(layer, screenLeft, screenWidth, entry, railWidth);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', externalizeAnnotations, { once: true });
    } else {
      externalizeAnnotations();
    }
    window.addEventListener('load', externalizeAnnotations);
    window.addEventListener('resize', externalizeAnnotations);
    requestAnimationFrame(externalizeAnnotations);
    setTimeout(externalizeAnnotations, 120);
    setTimeout(externalizeAnnotations, 500);
  })();
</script>`

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

function isFigma2PrefabPrototypeHtml(html: string) {
  return /data-generator=["']figma2prefab["']/iu.test(html)
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
  const isFigma2Prefab = isFigma2PrefabPrototypeHtml(parsed)
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
  const headAdditions = isFigma2Prefab
    ? [viewport, storageShim, PROTOTYPE_ANNOTATION_STRIP_STYLE, PROTOTYPE_ANNOTATION_STRIP_SCRIPT].filter(Boolean).join('\n')
    : [viewport, storageShim, tailwind, baseStyle, PROTOTYPE_ANNOTATION_STRIP_STYLE, fitRootScript, PROTOTYPE_ANNOTATION_STRIP_SCRIPT].filter(Boolean).join('\n')

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
