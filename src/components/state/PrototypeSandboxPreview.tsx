import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { normalizePrototypeHtml } from '../../lib/prototypeUtils'

interface PrototypeSandboxPreviewProps {
  html: string | null
  title?: string
  interactive?: boolean
  mode?: 'viewport' | 'aspect' | 'thumbnail' | 'full-page' | 'actual'
  className?: string
  fallback?: ReactNode
}

interface PrototypePreviewSurfaceProps extends PrototypeSandboxPreviewProps {
  fit?: 'aspect' | 'pane' | 'thumbnail' | 'fullPage' | 'actual'
  surfaceClassName?: string
  style?: CSSProperties
  children?: ReactNode
}

const PROTOTYPE_PREVIEW_SURFACE_BASE_CLASS = 'relative flex min-h-0 items-start justify-center overflow-hidden bg-black'

function hashPreviewHtml(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return hash.toString(36)
}

export function PrototypeSandboxPreview({
  html,
  title = 'Prototype preview',
  interactive = false,
  mode = 'viewport',
  className = '',
  fallback = null,
}: PrototypeSandboxPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const normalizedHtml = useMemo(() => (html ? normalizePrototypeHtml(html) : null), [html])
  const iframeKey = useMemo(
    () => normalizedHtml ? `${mode}-${normalizedHtml.length}-${hashPreviewHtml(normalizedHtml)}` : mode,
    [mode, normalizedHtml],
  )

  function hydrateSandbox() {
    if (!normalizedHtml) return
    iframeRef.current?.contentWindow?.postMessage({ action: 'hydrate', html: normalizedHtml, mode }, '*')
  }

  useEffect(() => {
    hydrateSandbox()
    const timer = window.setTimeout(hydrateSandbox, 0)
    return () => window.clearTimeout(timer)
  }, [normalizedHtml, mode])

  if (!normalizedHtml) return fallback

  return (
    <iframe
      key={iframeKey}
      ref={iframeRef}
      src="/sandbox.html"
      className={[
        interactive ? '' : 'pointer-events-none',
        'h-full w-full border-none',
        className,
      ].filter(Boolean).join(' ')}
      sandbox={import.meta.env.DEV ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
      onLoad={hydrateSandbox}
      title={title}
    />
  )
}

export function PrototypePreviewSurface({
  html,
  title,
  interactive,
  className,
  fallback,
  fit = 'aspect',
  surfaceClassName = '',
  style,
  children,
}: PrototypePreviewSurfaceProps) {
  const fitClassName = {
    aspect: 'aspect-[375/812] w-full',
    pane: 'mx-auto h-full w-full max-w-[375px]',
    thumbnail: 'h-[320px] w-full',
    fullPage: 'h-full w-full',
    actual: 'h-full w-full',
  }[fit]
  const sandboxMode = fit === 'fullPage'
    ? 'full-page'
    : fit === 'pane'
      ? 'viewport'
      : fit

  return (
    <div
      className={[PROTOTYPE_PREVIEW_SURFACE_BASE_CLASS, fitClassName, surfaceClassName].filter(Boolean).join(' ')}
      style={style}
    >
      <PrototypeSandboxPreview
        html={html}
        title={title}
        interactive={interactive}
        mode={sandboxMode}
        className={className}
        fallback={fallback}
      />
      {children}
    </div>
  )
}
