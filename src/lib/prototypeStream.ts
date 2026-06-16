import type { PrototypeVariantPayload } from './api'
import type { ContentBlock } from '../types/chat'
import type { PrototypeAssetAuditIssue, PrototypeAssetManifest } from '../types/prototypeAssets'
import type { UXRequirementState } from '../types/uxRequirement'

export type PrototypeStreamEvent =
  | { type: 'setCode'; variantIndex: number; html: string | null; focus?: string; history?: string[] }
  | ({ type: 'variantComplete'; variantIndex: number; html: string | null; focus?: string; history?: string[]; assetAudit?: PrototypeAssetAuditIssue[] } & Partial<Pick<PrototypeVariantPayload, 'mode' | 'appliedEdits'>>)
  | { type: 'variantError'; variantIndex: number; focus?: string; message?: string }
  | { type: 'done' }

interface PrototypeStreamOptions {
  currentHtml?: string | null
  instruction?: string
  images?: ContentBlock[]
  numVariants?: number
  variantIndex?: number
  history?: string[]
  assetManifest?: PrototypeAssetManifest
}

export async function streamPrototype(
  baseUrl: string,
  requirementState: UXRequirementState,
  options: PrototypeStreamOptions,
  onEvent: (event: PrototypeStreamEvent) => void,
) {
  const imageBlocks = (options.images ?? []).filter((block) => block.type === 'image')
  const response = await fetch(`${baseUrl}/api/prototype/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirementState,
      currentHtml: options.currentHtml ?? null,
      instruction: options.instruction ?? null,
      images: imageBlocks,
      numVariants: options.numVariants ?? null,
      variantIndex: options.variantIndex ?? null,
      history: options.history ?? null,
      assetManifest: options.assetManifest ?? null,
      stream: true,
    }),
  })

  if (!response.ok) {
    let message = `Prototype stream failed: ${response.status}`
    try {
      const data = await response.json() as { error?: string }
      if (data.error) message = data.error
    } catch { /* use status */ }
    throw new Error(message)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('浏览器不支持原型流式响应。')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''

    for (const chunk of chunks) {
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      onEvent(JSON.parse(dataLine.slice(6)) as PrototypeStreamEvent)
    }
  }
}
