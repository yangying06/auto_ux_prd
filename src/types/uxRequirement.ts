export interface AssetDependency {
  type: string
  path: string | null
  is_ready: boolean
}

export type UIComponentState = 'idle' | 'hover' | 'pressed' | 'disabled' | 'loading' | 'active' | 'error'

export interface UIComponent {
  /** 组件名称，如 TaskButton、TaskPanel */
  name: string
  /** 组件类型，如 Button、Panel、ScrollView、Label、Sprite、ProgressBar */
  type: string
  /** 该组件有哪些状态 */
  states: UIComponentState[]
  /** 出现动画，如 fadeIn 300ms、slideInRight 400ms ease-out */
  animation_in: string | null
  /** 消失动画，如 fadeOut 200ms */
  animation_out: string | null
  /** 层级顺序（z-order），数字越大越靠前 */
  z_order: number
  /** 备注，如特殊交互逻辑、条件显示 */
  notes: string | null
  /** 子组件 */
  children: UIComponent[]
}

export interface SlotConfidence {
  trigger_condition: number
  sequence_rules: number
  asset_dependencies: number
  engine_constraints: number
}

export interface MissingReasons {
  trigger_condition: string | null
  sequence_rules: string | null
  asset_dependencies: string | null
  engine_constraints: string | null
}

export interface UXRequirementState {
  trigger_condition: string | null
  sequence_rules: string | null
  asset_dependencies: AssetDependency[]
  engine_constraints: string | null
  /** 单界面组件树（对应 GDevelop OrchestratorPlan 的 tasks） */
  ui_components: UIComponent[]
  /** AI 建议的多个快速回答选项（对应 GDevelop SuggestionLines） */
  suggested_answers: string[]
  completion_rate: number
  slot_confidence: SlotConfidence
  missing_reasons: MissingReasons
  next_question: string | null
}
