import type {
  PrdNode,
  PrdPerformanceBlockingQuestion,
  PrdPerformanceReadiness,
  PrdPerformanceSequenceStep,
  PrdPerformanceSlotKey,
  PrdPerformanceSlotStatus,
  PrdPerformanceSlotStatusMap,
  PrdPerformanceSlotStatusValue,
  PrdPerformanceSpec,
} from '../types/prdNode'
import { COCOS_MOTION_INTEGRATION_MODES, COCOS_MOTION_RULES } from '../data/cocosMotionQuestionBank'

const PERFORMANCE_SLOT_DEFINITIONS: Array<{
  key: PrdPerformanceSlotKey
  label: string
  question: string
}> = [
  { key: 'trigger', label: '触发', question: '这个表现由哪个用户动作、接口字段、状态变化或系统事件触发？' },
  { key: 'branches', label: '分支', question: '不同结果、等级、道具、金额或异常状态是否使用不同表现？' },
  { key: 'sequence', label: '播放顺序', question: '完整播放顺序是什么？哪些阶段必须等待上一段完成？' },
  { key: 'integrationModes', label: '接入方式', question: '每段分别用 Tween、AnimationClip、Spine、ParticleSystem、Prefab、序列帧还是音效联动接入？' },
  { key: 'assets', label: '资源', question: '表现资源分别使用哪些 Spine、AnimationClip、粒子、音效、图标、弹窗或文案？资源缺失时怎么兜底？' },
  { key: 'layers', label: '层级', question: '表现播放在哪些层级上：原界面、内容层、HUD、UIEffect、PopUp、Dialog、Notify 还是 Guide？' },
  { key: 'controls', label: '控制', question: '表现期间能否跳过、打断、重复触发、排队或合并多个结果？' },
  { key: 'endState', label: '结束状态', question: '播放完成后界面回到哪里？哪些数值、按钮、列表或状态需要刷新？' },
]

const PERFORMANCE_SLOT_KEYS = PERFORMANCE_SLOT_DEFINITIONS.map((definition) => definition.key)
const PERFORMANCE_BLOCKING_SLOT_PRIORITY: PrdPerformanceSlotKey[] = [
  'trigger',
  'branches',
  'sequence',
  'integrationModes',
  'assets',
  'layers',
  'controls',
  'endState',
]
const PERFORMANCE_SLOT_LABELS = Object.fromEntries(
  PERFORMANCE_SLOT_DEFINITIONS.map((definition) => [definition.key, definition.label]),
) as Record<PrdPerformanceSlotKey, string>
const PERFORMANCE_SLOT_QUESTIONS = Object.fromEntries(
  PERFORMANCE_SLOT_DEFINITIONS.map((definition) => [definition.key, definition.question]),
) as Record<PrdPerformanceSlotKey, string>
const SLOT_STATUS_VALUES = new Set<PrdPerformanceSlotStatusValue>(['missing', 'inferred', 'confirmed', 'waived'])

export interface PerformanceAnswerFastResult {
  reply: string
  performanceSpec: PrdPerformanceSpec
}

const PERFORMANCE_FAST_REPLY_OPTIONS: Record<PrdPerformanceSlotKey, string[]> = {
  trigger: ['接口返回后', '用户点击后', '状态变化后', '我来描述'],
  branches: ['统一流程', '按等级分支', '异常单独处理', '我来描述'],
  sequence: ['逐段等待', '并行后收尾', '数值后飞入', '我来描述'],
  integrationModes: ['Tween+粒子', 'Animation/Spine', 'Prefab 承载', '先占位'],
  assets: ['资源已准备', '资源待补', '复用现有', '缺失降级'],
  layers: ['UIEffect', '原界面内', 'PopUp/Dialog', 'HUD 层'],
  controls: ['禁止重复', '合并触发', '允许跳过', '打断回滚'],
  endState: ['结束后刷新', '关闭后刷新', '先刷新再播', '保持当前页'],
}

function shortText(value: string, max = 160) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function isUnresolvedPerformanceAnswer(value: string) {
  return /待补|待定|暂未|暂无|未确认|不确定|不知道|占位|后续|稍后|缺失/u.test(value)
}

function isWaivedPerformanceAnswer(value: string) {
  return /无特殊表现|无需表现|不用动效|不需要额外|豁免/u.test(value)
}

function appendUniqueString(items: string[] | undefined, value: string, limit = 12) {
  return unique([...(items ?? []), value], limit)
}

function inferConfirmedIntegrationModes(value: string) {
  const modes: string[] = []
  if (/tween|补间|位移|缩放|滚动|飞入/i.test(value)) modes.push('Cocos Tween 变换')
  if (/animationclip|cc\.animation|animation|动画片段/i.test(value)) modes.push('AnimationClip/cc.Animation')
  if (/spine|skeleton|骨骼/i.test(value)) modes.push('Spine/Skeleton')
  if (/particle|粒子/i.test(value)) modes.push('ParticleSystem 粒子')
  if (/prefab|弹窗|实例化/i.test(value)) modes.push('Prefab 特效/弹窗')
  if (/序列帧|sequence/i.test(value)) modes.push('序列帧')
  if (/音效|audio|sound/i.test(value)) modes.push('音效联动')
  return unique(modes, 8)
}

function inferConfirmedLayers(value: string) {
  const layers: string[] = []
  if (/uieffect/i.test(value)) layers.push('UIEffect')
  if (/hud/i.test(value)) layers.push('HUD')
  if (/popup/i.test(value)) layers.push('PopUp')
  if (/dialog/i.test(value)) layers.push('Dialog')
  if (/notify/i.test(value)) layers.push('Notify')
  if (/guide/i.test(value)) layers.push('Guide')
  if (/原界面|组件位置|原位置/u.test(value)) layers.push('原界面内')
  return unique(layers, 8)
}

function cloneSlotStatus(spec: PrdPerformanceSpec): PrdPerformanceSlotStatusMap {
  const normalized = normalizePerformanceSpec(spec)
  const source = normalized?.slotStatus ?? spec.slotStatus
  return Object.fromEntries(PERFORMANCE_SLOT_KEYS.map((key) => [
    key,
    {
      status: source?.[key]?.status ?? (slotHasValue(spec, key) ? 'inferred' : 'missing'),
      detail: source?.[key]?.detail ?? summarizeSlotValue(spec, key),
      question: source?.[key]?.question ?? PERFORMANCE_SLOT_QUESTIONS[key],
    },
  ])) as PrdPerformanceSlotStatusMap
}

function applyAnswerToPerformanceSlot(
  spec: PrdPerformanceSpec,
  slot: PrdPerformanceSlotKey,
  answer: string,
  status: PrdPerformanceSlotStatusValue,
) {
  const detail = shortText(answer)
  const next: PrdPerformanceSpec = {
    ...spec,
    source: 'user',
    updatedAt: new Date().toISOString(),
  }

  if (status === 'waived') return next

  if (slot === 'trigger') next.trigger = detail
  if (slot === 'branches') next.branches = appendUniqueString(next.branches, detail, 8)
  if (slot === 'sequence') {
    next.sequence = [
      ...next.sequence,
      {
        id: `confirmed-sequence-${next.sequence.length + 1}`,
        title: next.sequence.length ? `补充阶段 ${next.sequence.length + 1}` : '用户确认流程',
        detail,
      },
    ].slice(0, 10)
  }
  if (slot === 'integrationModes') {
    const modes = inferConfirmedIntegrationModes(answer)
    next.integrationModes = modes.length
      ? unique([...(next.integrationModes ?? []), ...modes], 10)
      : appendUniqueString(next.integrationModes, detail, 10)
  }
  if (slot === 'assets') next.assets = appendUniqueString(next.assets, detail, 12)
  if (slot === 'layers') {
    const layers = inferConfirmedLayers(answer)
    next.layers = layers.length ? unique([...next.layers, ...layers], 8) : appendUniqueString(next.layers, detail, 8)
  }
  if (slot === 'controls') next.controls = appendUniqueString(next.controls, detail, 8)
  if (slot === 'endState') next.endState = detail

  return next
}

export function applyPerformanceAnswerFast(
  currentSpec: PrdPerformanceSpec | null,
  answerText: string,
): PerformanceAnswerFastResult | null {
  const normalized = normalizePerformanceSpec(currentSpec)
  const answer = answerText.trim()
  if (!normalized?.detected || normalized.disabled || !answer) return null

  const currentSlot = normalized.blockingQuestion?.slot
    ?? PERFORMANCE_BLOCKING_SLOT_PRIORITY.find((key) => normalized.slotStatus?.[key]?.status === 'missing')
    ?? PERFORMANCE_BLOCKING_SLOT_PRIORITY.find((key) => normalized.slotStatus?.[key]?.status === 'inferred')
    ?? null
  if (!currentSlot) return null

  const slotStatus = cloneSlotStatus(normalized)
  const status: PrdPerformanceSlotStatusValue = isWaivedPerformanceAnswer(answer)
    ? 'waived'
    : isUnresolvedPerformanceAnswer(answer)
      ? 'inferred'
      : 'confirmed'

  const patched = applyAnswerToPerformanceSlot(normalized, currentSlot, answer, status)
  slotStatus[currentSlot] = {
    status,
    detail: status === 'waived' ? `用户豁免：${shortText(answer)}` : shortText(answer),
    question: status === 'confirmed' || status === 'waived' ? null : PERFORMANCE_SLOT_QUESTIONS[currentSlot],
  }

  const performanceSpec = normalizePerformanceSpec({
    ...patched,
    confidence: Math.max(patched.confidence, status === 'confirmed' || status === 'waived' ? 82 : 68),
    openQuestions: normalized.openQuestions.filter((question) => question !== normalized.blockingQuestion?.question),
    blockingQuestion: null,
    slotStatus,
  })
  if (!performanceSpec) return null

  const score = performanceSpec.readiness?.score ?? performanceSpec.confidence
  const nextQuestion = performanceSpec.blockingQuestion
  const reply = nextQuestion
    ? [
        `整体理解度：${score}%`,
        `当前卡住：${PERFORMANCE_SLOT_LABELS[nextQuestion.slot]} - ${nextQuestion.question}`,
        `可选：${PERFORMANCE_FAST_REPLY_OPTIONS[nextQuestion.slot].join(' / ')}`,
      ].join('\n')
    : [
        `整体理解度：${score}%`,
        '表现编排 8 个槽位已确认，可以继续打磨文档或同步右侧原型。',
      ].join('\n')

  return { reply, performanceSpec }
}

function unique(items: string[], limit = 12) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= limit) break
  }
  return result
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function collectNodeText(node: PrdNode) {
  const sectionText = Object.values(node.sections ?? {})
    .map((section) => [
      section?.title,
      section?.summary,
      section?.content,
      ...(section?.openQuestions ?? []),
    ].filter(Boolean).join('\n'))
    .join('\n')

  return [
    node.label,
    node.summary,
    node.content,
    node.techNotes,
    node.handoffGoal,
    node.qualityGate,
    sectionText,
  ].filter(Boolean).join('\n')
}

function normalizeSequence(value: unknown): PrdPerformanceSequenceStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): PrdPerformanceSequenceStep[] => {
    if (typeof item === 'string') {
      const text = item.trim()
      return text ? [{ id: `step-${index + 1}`, title: `阶段 ${index + 1}`, detail: text }] : []
    }
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const title = typeof candidate.title === 'string'
      ? candidate.title.trim()
      : typeof candidate.label === 'string'
        ? candidate.label.trim()
        : `阶段 ${index + 1}`
    const detail = typeof candidate.detail === 'string'
      ? candidate.detail.trim()
      : typeof candidate.description === 'string'
        ? candidate.description.trim()
        : ''
    if (!title && !detail) return []
    return [{
      id: typeof candidate.id === 'string' ? candidate.id.trim() : `step-${index + 1}`,
      title: title || `阶段 ${index + 1}`,
      detail,
      layer: typeof candidate.layer === 'string' ? candidate.layer.trim() || null : null,
      assets: normalizeStringArray(candidate.assets),
      waitFor: typeof candidate.waitFor === 'string'
        ? candidate.waitFor.trim() || null
        : typeof candidate.wait_for === 'string'
          ? candidate.wait_for.trim() || null
          : null,
    }]
  }).slice(0, 10)
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return unique(value.flatMap((item) => {
    if (typeof item !== 'string') return []
    const text = item.trim()
    return text ? [text] : []
  }))
}

function collectIntegrationModes(text: string, ruleModes: string[] = []) {
  return unique([
    ...ruleModes,
    ...COCOS_MOTION_INTEGRATION_MODES.flatMap((mode) => (
      mode.keywords.test(text) ? [mode.label] : []
    )),
  ], 10)
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

function normalizeSlotKey(value: unknown): PrdPerformanceSlotKey | null {
  if (typeof value !== 'string') return null
  return PERFORMANCE_SLOT_KEYS.includes(value as PrdPerformanceSlotKey) ? value as PrdPerformanceSlotKey : null
}

function normalizeSlotStatusValue(value: unknown): PrdPerformanceSlotStatusValue | null {
  if (typeof value !== 'string') return null
  return SLOT_STATUS_VALUES.has(value as PrdPerformanceSlotStatusValue) ? value as PrdPerformanceSlotStatusValue : null
}

function slotHasValue(spec: PrdPerformanceSpec, key: PrdPerformanceSlotKey) {
  if (key === 'trigger') return Boolean(spec.trigger)
  if (key === 'branches') return spec.branches.length > 0 || spec.eventTypes.length <= 1
  if (key === 'sequence') return spec.sequence.length > 0
  if (key === 'integrationModes') return Boolean(spec.integrationModes?.length)
  if (key === 'assets') return spec.assets.length > 0
  if (key === 'layers') return spec.layers.length > 0
  if (key === 'controls') return spec.controls.length > 0
  return Boolean(spec.endState)
}

function summarizeSlotValue(spec: PrdPerformanceSpec, key: PrdPerformanceSlotKey) {
  if (key === 'trigger') return spec.trigger
  if (key === 'branches') return spec.branches.join('；') || (spec.eventTypes.length <= 1 ? '当前未识别明显分支，按单一表现流程处理。' : null)
  if (key === 'sequence') return spec.sequence.map((step) => step.title).join(' → ') || null
  if (key === 'integrationModes') return spec.integrationModes?.join('、') || null
  if (key === 'assets') return spec.assets.join('、') || null
  if (key === 'layers') return spec.layers.join('、') || null
  if (key === 'controls') return spec.controls.join('；') || null
  return spec.endState
}

function normalizeSlotStatusItem(value: unknown, spec: PrdPerformanceSpec, key: PrdPerformanceSlotKey): PrdPerformanceSlotStatus {
  const fallbackStatus: PrdPerformanceSlotStatusValue = spec.disabled
    ? 'waived'
    : slotHasValue(spec, key)
      ? spec.source === 'user' ? 'confirmed' : 'inferred'
      : 'missing'
  const fallbackQuestion = PERFORMANCE_SLOT_QUESTIONS[key]

  if (typeof value === 'string') {
    const status = normalizeSlotStatusValue(value) ?? fallbackStatus
    return {
      status,
      detail: status === 'missing' ? null : summarizeSlotValue(spec, key),
      question: status === 'missing' || status === 'inferred' ? fallbackQuestion : null,
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>
    const status = normalizeSlotStatusValue(candidate.status) ?? fallbackStatus
    return {
      status,
      detail: nullableString(candidate.detail) ?? (status === 'missing' ? null : summarizeSlotValue(spec, key)),
      question: nullableString(candidate.question) ?? (status === 'missing' || status === 'inferred' ? fallbackQuestion : null),
    }
  }

  return {
    status: fallbackStatus,
    detail: fallbackStatus === 'missing' ? null : summarizeSlotValue(spec, key),
    question: fallbackStatus === 'missing' || fallbackStatus === 'inferred' ? fallbackQuestion : null,
  }
}

function normalizeSlotStatusMap(value: unknown, spec: PrdPerformanceSpec): PrdPerformanceSlotStatusMap {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return Object.fromEntries(PERFORMANCE_SLOT_KEYS.map((key) => [
    key,
    normalizeSlotStatusItem(source[key], spec, key),
  ])) as PrdPerformanceSlotStatusMap
}

function calculateReadiness(slotStatus: PrdPerformanceSlotStatusMap, disabled = false): PrdPerformanceReadiness {
  const confirmedSlots = PERFORMANCE_SLOT_KEYS.filter((key) => slotStatus[key].status === 'confirmed')
  const inferredSlots = PERFORMANCE_SLOT_KEYS.filter((key) => slotStatus[key].status === 'inferred')
  const missingSlots = PERFORMANCE_SLOT_KEYS.filter((key) => slotStatus[key].status === 'missing')
  const waivedSlots = PERFORMANCE_SLOT_KEYS.filter((key) => slotStatus[key].status === 'waived')
  const score = Math.round(PERFORMANCE_SLOT_KEYS.reduce((sum, key) => {
    const status = slotStatus[key].status
    if (status === 'confirmed' || status === 'waived') return sum + 100
    if (status === 'inferred') return sum + 65
    return sum
  }, 0) / PERFORMANCE_SLOT_KEYS.length)
  const level: PrdPerformanceReadiness['level'] = disabled || waivedSlots.length === PERFORMANCE_SLOT_KEYS.length
    ? 'waived'
    : missingSlots.length === 0 && inferredSlots.length === 0
      ? 'ready'
      : score >= 60
        ? 'risk'
        : 'blocked'
  const unresolvedSlots = [...missingSlots, ...inferredSlots]
  const riskSummary = level === 'ready'
    ? null
    : level === 'waived'
      ? '该节点已标记为无特殊表现或表现问题已被豁免。'
      : `表现仍有 ${unresolvedSlots.length} 个槽位未由设计师明确确认：${unresolvedSlots.map(formatPerformanceSlotLabel).join('、')}。`

  return {
    score,
    level,
    confirmedSlots,
    inferredSlots,
    missingSlots,
    waivedSlots,
    riskSummary,
  }
}

function normalizeReadiness(value: unknown, fallback: PrdPerformanceReadiness): PrdPerformanceReadiness {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const candidate = value as Record<string, unknown>
  const rawLevel = candidate.level === 'ready' || candidate.level === 'risk' || candidate.level === 'blocked' || candidate.level === 'waived'
    ? candidate.level
    : null
  const rawRiskSummary = nullableString(candidate.riskSummary ?? candidate.risk_summary)

  // Readiness is a derived protocol state. AI may supply a summary, but score,
  // level and slot lists must stay consistent with the normalized 8-slot map.
  return {
    ...fallback,
    riskSummary: rawLevel === fallback.level && rawRiskSummary ? rawRiskSummary : fallback.riskSummary,
  }
}

function normalizeBlockingQuestion(value: unknown, slotStatus: PrdPerformanceSlotStatusMap): PrdPerformanceBlockingQuestion | null {
  const firstMissing = PERFORMANCE_BLOCKING_SLOT_PRIORITY.find((key) => slotStatus[key].status === 'missing')
  const firstInferred = PERFORMANCE_BLOCKING_SLOT_PRIORITY.find((key) => slotStatus[key].status === 'inferred')
  const fallbackSlot = firstMissing ?? firstInferred ?? null
  const fallbackQuestion = fallbackSlot
    ? slotStatus[fallbackSlot].question ?? PERFORMANCE_SLOT_QUESTIONS[fallbackSlot]
    : null

  if (typeof value === 'string') {
    const question = value.trim()
    return question && fallbackSlot ? { slot: fallbackSlot, question } : null
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>
    const slot = normalizeSlotKey(candidate.slot) ?? fallbackSlot
    const question = nullableString(candidate.question) ?? (slot ? fallbackQuestion : null)
    if (slot && question) return { slot, question }
  }

  return fallbackSlot && fallbackQuestion ? { slot: fallbackSlot, question: fallbackQuestion } : null
}

function inferQuestionSlot(question: string): PrdPerformanceSlotKey {
  if (/字段|条件|触发|状态/.test(question)) return 'trigger'
  if (/等级|分支|不同|优先级|多个结果|同时命中/.test(question)) return 'branches'
  if (/顺序|先后|阶段|播完|播放完成|等待|自动关闭|点击关闭|飞入|路径|数量|间隔|滚动/.test(question)) return 'sequence'
  if (/Tween|Spine|粒子|Particle|AnimationClip|Prefab|prefab|序列帧|音效|接入/.test(question)) return 'integrationModes'
  if (/资源|素材|动画名|clip|音效名|命名|映射/.test(question)) return 'assets'
  if (/层级|layer|原位置|独立表现层|UIEffect|PopUp|Dialog/.test(question)) return 'layers'
  if (/跳过|打断|重复|合并|重播|防重|停止|允许/.test(question)) return 'controls'
  if (/结束后|播放完成后|刷新|回到|关闭后|下一步|恢复/.test(question)) return 'endState'
  return 'sequence'
}

function selectBlockingQuestion(
  questions: string[],
  slotPriority: PrdPerformanceSlotKey[],
): PrdPerformanceBlockingQuestion | null {
  if (!questions.length) return null
  const uniqueQuestions = unique(questions, 24)
  const priority = slotPriority.length ? slotPriority : PERFORMANCE_SLOT_KEYS

  for (const slot of priority) {
    const question = uniqueQuestions.find((item) => inferQuestionSlot(item) === slot)
    if (question) return { slot, question }
  }

  const question = uniqueQuestions[0]
  return question ? { slot: inferQuestionSlot(question), question } : null
}

function applyPerformanceProtocol(spec: PrdPerformanceSpec, raw?: Record<string, unknown>): PrdPerformanceSpec {
  const slotStatus = normalizeSlotStatusMap(raw?.slotStatus ?? raw?.slot_status, spec)
  const calculatedReadiness = calculateReadiness(slotStatus, spec.disabled === true)
  const readiness = normalizeReadiness(raw?.readiness, calculatedReadiness)
  const blockingQuestion = spec.disabled
    ? null
    : normalizeBlockingQuestion(raw?.blockingQuestion ?? raw?.blocking_question, slotStatus)

  return {
    ...spec,
    slotStatus,
    blockingQuestion,
    readiness,
    waivedReason: nullableString(raw?.waivedReason ?? raw?.waived_reason) ?? spec.waivedReason ?? null,
  }
}

export function formatPerformanceSlotLabel(slot: PrdPerformanceSlotKey) {
  return PERFORMANCE_SLOT_LABELS[slot]
}

export function normalizePerformanceSpec(value: unknown): PrdPerformanceSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const disabled = candidate.disabled === true
  const detected = disabled ? false : candidate.detected !== false
  const source = candidate.source === 'ai' || candidate.source === 'user' || candidate.source === 'auto'
    ? candidate.source
    : 'ai'

  const spec: PrdPerformanceSpec = {
    detected,
    disabled,
    source,
    confidence: clampConfidence(typeof candidate.confidence === 'number' ? candidate.confidence : detected ? 70 : 0),
    eventTypes: normalizeStringArray(candidate.eventTypes ?? candidate.event_types ?? candidate.types),
    integrationModes: normalizeStringArray(candidate.integrationModes ?? candidate.integration_modes ?? candidate.integrations),
    trigger: nullableString(candidate.trigger ?? candidate.triggerCondition ?? candidate.trigger_condition),
    branches: normalizeStringArray(candidate.branches ?? candidate.branchRules ?? candidate.branch_rules),
    sequence: normalizeSequence(candidate.sequence ?? candidate.flow ?? candidate.steps),
    assets: normalizeStringArray(candidate.assets ?? candidate.resources ?? candidate.resourceList ?? candidate.resource_list),
    layers: normalizeStringArray(candidate.layers ?? candidate.layerRules ?? candidate.layer_rules),
    controls: normalizeStringArray(candidate.controls ?? candidate.controlRules ?? candidate.control_rules),
    endState: nullableString(candidate.endState ?? candidate.end_state),
    openQuestions: normalizeStringArray(candidate.openQuestions ?? candidate.open_questions ?? candidate.questions),
    prototypeNotes: normalizeStringArray(candidate.prototypeNotes ?? candidate.prototype_notes ?? candidate.prototype),
    waivedReason: nullableString(candidate.waivedReason ?? candidate.waived_reason),
    updatedAt: nullableString(candidate.updatedAt ?? candidate.updated_at),
  }
  return applyPerformanceProtocol(spec, candidate)
}

export function inferPerformanceSpecFromNode(node: PrdNode): PrdPerformanceSpec | null {
  const text = collectNodeText(node)
  if (!text.trim()) return null

  const matches = COCOS_MOTION_RULES.filter((rule) => rule.pattern.test(text))
  if (!matches.length) return null

  const confidence = clampConfidence(35 + matches.reduce((sum, rule) => sum + rule.weight, 0))
  const sequence = matches.flatMap((rule) => rule.sequence)
  const eventTypes = unique(matches.map((rule) => rule.type), 8)
  const integrationModes = collectIntegrationModes(text, matches.flatMap((rule) => rule.integrationModes))
  const hasSequentialWords = /然后|随后|依次|播完|结束后|阶段|队列|sequence|loop|out/.test(text)
  const hasResultWords = /中奖|jackpot|bigwin|bonus|free|奖励|成功|完成|解锁|获得|失败|错误/.test(text)
  const modeQuestions = integrationModes.length
    ? [`这段表现建议按 ${integrationModes.join('、')} 接入；哪些已有资源可以直接复用，哪些需要程序用占位或 Tween 补齐？`]
    : []
  const blockingQuestion = selectBlockingQuestion(
    [
      ...matches.flatMap((rule) => rule.questions),
      ...modeQuestions,
      ...COCOS_MOTION_INTEGRATION_MODES.flatMap((mode) => (
        mode.keywords.test(text) ? mode.designerQuestions : []
      )),
    ],
    unique([
      ...matches.flatMap((rule) => rule.slotPriority ?? []),
      ...COCOS_MOTION_INTEGRATION_MODES.flatMap((mode) => (
        mode.keywords.test(text) ? mode.slotPriority ?? [] : []
      )),
    ], PERFORMANCE_SLOT_KEYS.length) as PrdPerformanceSlotKey[],
  )

  const openQuestions = unique([
    hasResultWords ? '触发这个表现的结果字段、状态或条件是什么？' : '这个表现由哪个用户动作、系统事件或状态变化触发？',
    ...matches.flatMap((rule) => rule.questions),
    ...modeQuestions,
    hasSequentialWords ? 'PRD 中提到的“然后/结束后”是否必须严格等待上一段播放完成？' : '完整播放顺序是什么？哪些阶段需要等待上一段完成？',
    '表现资源分别使用哪些 Spine、AnimationClip、粒子、音效、图标、弹窗或文案？资源缺失时怎么兜底？',
    '表现播放在哪些层级上：原界面、内容层、HUD、弹窗层、全屏遮罩还是全局特效层？',
    '表现期间能否跳过、打断、重复触发或合并多个结果？',
    '播放完成后界面回到哪里？哪些数值、按钮、列表或状态需要刷新？',
  ], 7)

  const spec: PrdPerformanceSpec = {
    detected: true,
    source: 'auto',
    confidence,
    eventTypes,
    integrationModes,
    trigger: hasResultWords
      ? '根据结果返回、命中条件或完成状态触发，具体字段待确认。'
      : '根据节点中的表现事件触发，具体触发条件待确认。',
    branches: eventTypes.length > 1
      ? ['当前节点疑似包含多类表现，需要确认不同结果/对象/等级是否复用同一套流程或分支播放。']
      : [],
    sequence: uniqueSequence(sequence),
    assets: unique(matches.flatMap((rule) => rule.assets ?? []), 12),
    layers: unique(matches.flatMap((rule) => rule.layers ?? []), 8),
    controls: unique(matches.flatMap((rule) => rule.controls ?? []), 8),
    endState: '表现完成后刷新相关状态并回到原节点定义的后续界面，具体关闭/跳转规则待确认。',
    openQuestions,
    prototypeNotes: unique(matches.flatMap((rule) => rule.prototypeNotes ?? []), 6),
  }
  return applyPerformanceProtocol(spec, blockingQuestion ? { blockingQuestion } : undefined)
}

function uniqueSequence(steps: PrdPerformanceSequenceStep[]) {
  const seen = new Set<string>()
  const result: PrdPerformanceSequenceStep[] = []
  for (const step of steps) {
    const key = `${step.title}\n${step.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...step, id: step.id ?? `step-${result.length + 1}` })
  }
  return result.slice(0, 8)
}

export function createNoSpecialPerformanceSpec(reason = '用户标记该节点无特殊表现，只按基础 UI/状态说明交付。'): PrdPerformanceSpec {
  const spec: PrdPerformanceSpec = {
    detected: false,
    disabled: true,
    source: 'user',
    confidence: 100,
    eventTypes: [],
    integrationModes: [],
    trigger: null,
    branches: [],
    sequence: [],
    assets: [],
    layers: [],
    controls: [],
    endState: null,
    openQuestions: [],
    prototypeNotes: [],
    waivedReason: reason,
    updatedAt: new Date().toISOString(),
  }
  return applyPerformanceProtocol(spec)
}

export function resolveNodePerformanceSpec(node: PrdNode): PrdPerformanceSpec | null {
  const normalized = normalizePerformanceSpec(node.performanceSpec)
  if (normalized?.disabled) return normalized
  if (normalized && normalized.source !== 'auto') return normalized
  return inferPerformanceSpecFromNode(node) ?? normalized
}

export function hasActionablePerformanceSpec(node: PrdNode) {
  const spec = resolveNodePerformanceSpec(node)
  return Boolean(spec?.detected && !spec.disabled)
}

export function formatPerformanceSpecMarkdown(spec: PrdPerformanceSpec | null) {
  if (!spec) return ''
  if (spec.disabled) {
    return [
      '## 表现编排',
      '',
      '已标记为无特殊表现；该节点只按基础 UI/状态说明交付。',
      spec.waivedReason ? `豁免原因：${spec.waivedReason}` : null,
    ].filter((line): line is string => line !== null).join('\n')
  }
  if (!spec.detected) return ''

  const lines = [
    '## 表现编排',
    '',
    `**识别来源：** ${spec.source === 'auto' ? '系统自动扫描' : spec.source === 'ai' ? 'AI 打磨' : '用户确认'}`,
    `**置信度：** ${spec.confidence}%`,
    spec.readiness ? `**表现可实现度：** ${spec.readiness.score}%（${spec.readiness.level === 'ready' ? '已确认' : spec.readiness.level === 'risk' ? '有风险' : spec.readiness.level === 'blocked' ? '阻塞较多' : '已豁免'}）` : null,
    spec.eventTypes.length ? `**表现类型：** ${spec.eventTypes.join('、')}` : null,
    spec.integrationModes?.length ? `**接入方式建议：** ${spec.integrationModes.join('、')}` : null,
    spec.blockingQuestion ? `**当前最阻塞：** [${formatPerformanceSlotLabel(spec.blockingQuestion.slot)}] ${spec.blockingQuestion.question}` : null,
    '',
    '### 触发条件',
    '',
    spec.trigger ?? '待确认。',
  ].filter((line): line is string => line !== null)

  if (spec.readiness || spec.slotStatus) {
    const slotStatus = spec.slotStatus
    const readiness = spec.readiness
    lines.push('', '### 表现确认状态', '')
    if (readiness?.riskSummary) lines.push(readiness.riskSummary)
    if (slotStatus) {
      const byStatus = (status: PrdPerformanceSlotStatusValue) => PERFORMANCE_SLOT_KEYS
        .filter((key) => slotStatus[key].status === status)
        .map((key) => formatPerformanceSlotLabel(key))
      const confirmed = byStatus('confirmed')
      const inferred = byStatus('inferred')
      const missing = byStatus('missing')
      const waived = byStatus('waived')
      if (confirmed.length) lines.push(`- 设计师已确认：${confirmed.join('、')}`)
      if (inferred.length) lines.push(`- AI 推断待确认：${inferred.join('、')}`)
      if (missing.length) lines.push(`- 仍待确认：${missing.join('、')}`)
      if (waived.length) lines.push(`- 已豁免：${waived.join('、')}`)
    }
  }

  if (spec.branches.length) {
    lines.push('', '### 分支规则', '', ...spec.branches.map((item) => `- ${item}`))
  }

  if (spec.sequence.length) {
    lines.push('', '### 播放流程', '')
    for (const [index, step] of spec.sequence.entries()) {
      lines.push(`${index + 1}. ${step.title}：${step.detail}`)
      if (step.layer) lines.push(`   - 层级：${step.layer}`)
      if (step.assets?.length) lines.push(`   - 资源：${step.assets.join('、')}`)
      if (step.waitFor) lines.push(`   - 等待：${step.waitFor}`)
    }
  }

  if (spec.assets.length) lines.push('', '### 资源清单', '', ...spec.assets.map((item) => `- ${item}`))
  if (spec.integrationModes?.length) lines.push('', '### 接入方式', '', ...spec.integrationModes.map((item) => `- ${item}`))
  if (spec.layers.length) lines.push('', '### 层级规则', '', ...spec.layers.map((item) => `- ${item}`))
  if (spec.controls.length) lines.push('', '### 控制规则', '', ...spec.controls.map((item) => `- ${item}`))

  lines.push('', '### 结束状态', '', spec.endState ?? '待确认。')

  if (spec.openQuestions.length) {
    lines.push('', '### 待确认问题', '', ...spec.openQuestions.map((item) => `- ${item}`))
  }

  if (spec.prototypeNotes.length) {
    lines.push('', '### 原型迭代提示', '', ...spec.prototypeNotes.map((item) => `- ${item}`))
  }

  return lines.join('\n')
}

export function formatPerformanceSpecForPrompt(spec: PrdPerformanceSpec | null) {
  const markdown = formatPerformanceSpecMarkdown(spec)
  return markdown || '未识别到需要单独澄清的表现编排。'
}
