export type PrototypeVariantStatus = 'pending' | 'streaming' | 'complete' | 'error'

export interface PrototypeVariant {
  index: number
  html: string | null
  status: PrototypeVariantStatus
  model?: string
  focus?: string
  history?: string[]
  error?: string
}
