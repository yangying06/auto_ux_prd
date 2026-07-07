import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import type { PrototypeFlowJumpEdge } from '../../lib/prototypeFlowInteraction'
import { normalizePrototypeHtml } from '../../lib/prototypeUtils'

interface PrototypeSandboxPreviewProps {
  html: string | null
  title?: string
  interactive?: boolean
  mode?: 'viewport' | 'aspect' | 'thumbnail' | 'full-page' | 'actual'
  flowEdges?: PrototypeFlowJumpEdge[]
  onFlowJump?: (targetNodeId: string, edge: PrototypeFlowJumpEdge | null) => void
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
const EMPTY_FLOW_EDGES: PrototypeFlowJumpEdge[] = []

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
  flowEdges = EMPTY_FLOW_EDGES,
  onFlowJump,
  className = '',
  fallback = null,
}: PrototypeSandboxPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const flowEdgesRef = useRef<PrototypeFlowJumpEdge[]>([])
  const normalizedHtml = useMemo(() => (html ? normalizePrototypeHtml(html) : null), [html])
  const flowEdgePayload = useMemo(() => (
    flowEdges
      .map((edge) => ({
        id: edge.id ?? null,
        targetNodeId: edge.targetNodeId,
        label: edge.label ?? null,
        reason: edge.reason ?? null,
        targetLabel: edge.targetLabel ?? null,
      }))
      .filter((edge) => edge.targetNodeId)
  ), [flowEdges])
  const flowEdgeSignature = useMemo(() => JSON.stringify(flowEdgePayload), [flowEdgePayload])
  const iframeKey = useMemo(
    () => normalizedHtml ? `${mode}-${normalizedHtml.length}-${hashPreviewHtml(normalizedHtml)}` : mode,
    [mode, normalizedHtml],
  )

  const hydrateSandbox = useCallback(() => {
    if (!normalizedHtml) return
    iframeRef.current?.contentWindow?.postMessage({
      action: 'hydrate',
      html: normalizedHtml,
      mode,
      flowEdges: flowEdgePayload,
    }, '*')
  }, [flowEdgePayload, flowEdgeSignature, mode, normalizedHtml])

  useEffect(() => {
    hydrateSandbox()
    const timer = window.setTimeout(hydrateSandbox, 0)
    return () => window.clearTimeout(timer)
  }, [hydrateSandbox])

  useEffect(() => {
    flowEdgesRef.current = flowEdgePayload
  }, [flowEdgePayload, flowEdgeSignature])

  useEffect(() => {
    if (!onFlowJump) return undefined

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { action?: unknown; targetNodeId?: unknown; edgeId?: unknown } | null
      if (!data || data.action !== 'prototype-flow-jump' || typeof data.targetNodeId !== 'string') return

      const edge = flowEdgesRef.current.find((item) => (
        item.targetNodeId === data.targetNodeId
        && (typeof data.edgeId !== 'string' || item.id === data.edgeId)
      )) ?? flowEdgesRef.current.find((item) => item.targetNodeId === data.targetNodeId) ?? null

      if (!edge) return
      onFlowJump(data.targetNodeId, edge)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onFlowJump])

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
  flowEdges,
  onFlowJump,
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
        flowEdges={flowEdges}
        onFlowJump={onFlowJump}
        className={className}
        fallback={fallback}
      />
      {children}
    </div>
  )
}
