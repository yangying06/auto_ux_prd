import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { normalizePrototypeHtml } from '../../lib/prototypeUtils'

interface PrototypeSandboxPreviewProps {
  html: string | null
  title?: string
  interactive?: boolean
  mode?: 'viewport' | 'thumbnail'
  className?: string
  fallback?: ReactNode
}

interface PrototypePreviewSurfaceProps extends PrototypeSandboxPreviewProps {
  fit?: 'aspect' | 'pane' | 'thumbnail'
  surfaceClassName?: string
  style?: CSSProperties
  children?: ReactNode
}

const PROTOTYPE_PREVIEW_SURFACE_BASE_CLASS = 'relative flex min-h-0 items-start justify-center overflow-hidden bg-black'

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
    pane: 'h-full w-full',
    thumbnail: 'h-[320px] w-full',
  }[fit]
  const sandboxMode = fit === 'thumbnail' ? 'thumbnail' : 'viewport'

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
