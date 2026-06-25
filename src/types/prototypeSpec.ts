import type { PrdPerformanceSpec } from './prdNode'
import type { PrototypeAssetManifestMode } from './prototypeAssets'

export type PrototypeSpecMode = 'draft' | 'standard'

export interface PrototypeSpecComponent {
  id: string
  name: string
  type: string
  role: string
  states: string[]
  content?: string | null
  assetRefs: string[]
  constraints: string[]
}

export interface PrototypeSpecInteraction {
  trigger: string
  flow: string[]
  feedback: string[]
  edgeCases: string[]
}

export interface PrototypeSpecAssetPolicy {
  mode: PrototypeAssetManifestMode | 'open'
  allowedAssetRefs: string[]
  forbidden: string[]
  notes: string[]
}

export interface PrototypeSpec {
  schemaVersion: 'prototype-spec.v1'
  id: string
  mode: PrototypeSpecMode
  title: string
  sourceNodeId: string
  sourceNodeLabel: string
  sourceSummary: string
  sourceInputs: string[]
  htmlRole: 'preview'
  intent: string
  layout: {
    viewport: string
    structure: string[]
    visualReferences: string[]
  }
  components: PrototypeSpecComponent[]
  states: string[]
  interactions: PrototypeSpecInteraction[]
  performanceLogic: string[]
  performanceSpec?: PrdPerformanceSpec | null
  assetPolicy: PrototypeSpecAssetPolicy
  dataBindings: string[]
  platformConstraints: string[]
  acceptanceCriteria: string[]
  openQuestions: string[]
  standardizedFromSpecId?: string | null
  updatedAt: string
}
