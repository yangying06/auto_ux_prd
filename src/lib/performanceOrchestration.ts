import type { PrdNode, PrdPerformanceSequenceStep, PrdPerformanceSpec } from '../types/prdNode'

interface SignalRule {
  type: string
  weight: number
  pattern: RegExp
  sequence: PrdPerformanceSequenceStep[]
  questions: string[]
  assets?: string[]
  layers?: string[]
  controls?: string[]
  prototypeNotes?: string[]
}

const SIGNAL_RULES: SignalRule[] = [
  {
    type: '结果/奖励表现',
    weight: 28,
    pattern: /中奖|jackpot|抽中|抽奖|奖励|大奖|命中奖励|获得奖励|掉落|开箱|结算奖励|权益解锁|解锁奖励/i,
    sequence: [
      { title: '结果锁定', detail: '结果返回后先冻结当前演出对象，避免重复触发或提前刷新最终奖励。', layer: '逻辑结果层' },
      { title: '主结果表现', detail: '播放中奖、获得、解锁或达成的主表现，确认不同结果等级是否分支。', layer: '主表现层' },
    ],
    questions: [
      '这个结果由哪个字段或条件决定？不同等级是否播放不同表现？',
      '如果同时命中多个结果，主表现优先级如何排序？',
    ],
    assets: ['中奖/结果主特效', '奖励图标或结果标题'],
    layers: ['主表现层', '结果展示层'],
    controls: ['表现播放期间是否允许再次触发同类事件待确认'],
    prototypeNotes: ['原型需要展示结果锁定、主表现爆点和结果确认三个阶段。'],
  },
  {
    type: '金币/数值获得',
    weight: 24,
    pattern: /金币|coin|gold|钻石|宝石|积分|货币|资产|余额|数量|数值|金额|score|point|reward amount/i,
    sequence: [
      { title: '数值揭示', detail: '展示获得的金币、宝石、积分或金额，确认是直接显示还是滚动到最终值。', layer: '数值层' },
      { title: '资产归位', detail: '如需要，播放金币/图标飞入资产栏并在飞入结束后刷新最终数值。', layer: 'HUD 资产层' },
    ],
    questions: [
      '数值是直接出现、滚动增长，还是先隐藏再揭晓？',
      '金币/资产是否需要飞入顶部资产栏？刷新最终数值在飞入前还是飞入后？',
    ],
    assets: ['金币/资产图标', '数值滚动组件', '飞入粒子或轨迹'],
    layers: ['数值层', 'HUD 资产层'],
    controls: ['数值滚动期间是否可跳过待确认'],
    prototypeNotes: ['原型需要做出数字滚动或资产飞入的占位表现。'],
  },
  {
    type: '连线/命中表现',
    weight: 22,
    pattern: /连线|命中线|中奖线|line|棋盘|格子|组合|消除|匹配|高亮线|命中区域/i,
    sequence: [
      { title: '命中区域标记', detail: '高亮命中的线、格子或组合区域，确认逐条播放还是同时播放。', layer: '棋盘/内容层' },
      { title: '命中特效', detail: '在命中区域播放对应特效，确认是否等待该特效播完再进入下一阶段。', layer: '特效层' },
    ],
    questions: [
      '连线/命中区域是逐条播放还是所有命中项同时播放？',
      '命中特效播放完成后是否必须等待，再进入弹窗或奖励表现？',
    ],
    assets: ['连线高亮特效', '命中区域特效'],
    layers: ['棋盘/内容层', '特效层'],
    prototypeNotes: ['原型需要把命中区域和后续表现的先后关系做出来。'],
  },
  {
    type: '宝石/图标特效',
    weight: 18,
    pattern: /宝石|gem|图标|icon|符石|道具|碎片|item|道具特效|图标特效/i,
    sequence: [
      { title: '对象特效', detail: '在命中的宝石、图标或道具上播放专属特效，确认资源名和替换规则。', layer: '对象特效层' },
    ],
    questions: [
      '不同宝石、图标或道具是否使用不同特效资源？资源命名或映射规则是什么？',
      '对象特效是在原位置播放，还是复制到独立表现层播放？',
    ],
    assets: ['对象专属特效', '道具/宝石/图标资源'],
    layers: ['对象特效层'],
    prototypeNotes: ['原型需要标注哪个对象触发了哪类特效。'],
  },
  {
    type: '弹窗/揭晓表现',
    weight: 24,
    pattern: /弹窗|popup|modal|面板|揭晓|展开|弹出|关闭|收起|结果窗|奖励窗|toast/i,
    sequence: [
      { title: '弹窗入场', detail: '结果弹窗或提示层入场，确认展开方向、遮罩、是否全屏以及入场前置特效。', layer: '弹窗层' },
      { title: '确认与关闭', detail: '弹窗停留、自动关闭或等待用户点击关闭，确认关闭后是否继续播放收尾表现。', layer: '弹窗层' },
    ],
    questions: [
      '弹窗是自动关闭还是必须用户点击关闭？如果自动关闭，关闭前停留多久？',
      '弹窗入场前是否需要先播特效？关闭后是否还有收尾特效？',
    ],
    assets: ['弹窗 Prefab/面板', '遮罩', '入场/关闭特效'],
    layers: ['弹窗层', '遮罩层'],
    controls: ['弹窗展示期间是否允许跳过、关闭或重复点击待确认'],
    prototypeNotes: ['原型需要模拟弹窗入场、停留和关闭后的状态回落。'],
  },
  {
    type: '阶段演出/特效队列',
    weight: 26,
    pattern: /播放|特效|粒子|光效|音效|震屏|震动|动画|动效|展开|滚动|闪烁|高亮|飞入|播完|结束后|然后|随后|依次|阶段|队列/i,
    sequence: [
      { title: '前置表现', detail: '播放前置光效、音效、震屏或高亮，用来承接事件发生。', layer: '全局特效层' },
      { title: '队列推进', detail: '按阶段播放展开、滚动、主特效和收尾特效，确认每段是否等待上一段完成。', layer: '表现队列' },
    ],
    questions: [
      '完整播放顺序是什么？哪些阶段必须等上一个特效播完？',
      '震屏、音效、粒子分别在哪个阶段触发？是否存在资源缺失时的兜底表现？',
    ],
    assets: ['粒子/光效', '音效', '震屏参数'],
    layers: ['全局特效层', '表现队列'],
    controls: ['表现队列是否可被跳过、打断、合并或重播待确认'],
    prototypeNotes: ['原型需要用分阶段时间线表达播放顺序，而不是只画静态最终态。'],
  },
  {
    type: '成功/完成反馈',
    weight: 16,
    pattern: /成功|完成|达成|提交成功|支付成功|上传完成|生成完成|领取成功|强化成功|升级成功/i,
    sequence: [
      { title: '完成反馈', detail: '展示成功、完成、达成或已生成的明确反馈。', layer: '反馈层' },
      { title: '后续引导', detail: '表现结束后引导用户继续、查看详情、使用结果或返回原界面。', layer: '操作层' },
    ],
    questions: [
      '完成反馈结束后，用户下一步是关闭、查看详情、继续操作还是跳转？',
      '成功反馈是否需要和奖励、权益或数值变化串联播放？',
    ],
    assets: ['成功图标/完成态素材', '完成提示音'],
    layers: ['反馈层', '操作层'],
  },
  {
    type: '失败/风险提示',
    weight: 16,
    pattern: /失败|错误|异常|风险|警告|扣除|损失|强化失败|未命中|空奖|未中奖|error|warning/i,
    sequence: [
      { title: '异常提示', detail: '展示失败、风险、错误或未命中的结果提示，确认是否需要弱化或强调。', layer: '反馈层' },
      { title: '恢复路径', detail: '提示用户重试、补足条件、返回或查看原因。', layer: '操作层' },
    ],
    questions: [
      '失败或风险提示结束后，用户可以重试、返回还是必须确认？',
      '是否需要展示原因、损失、补偿或下一步解决路径？',
    ],
    assets: ['失败/警告图标', '错误提示音'],
    layers: ['反馈层', '操作层'],
  },
]

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

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

export function normalizePerformanceSpec(value: unknown): PrdPerformanceSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const disabled = candidate.disabled === true
  const detected = disabled ? false : candidate.detected !== false
  const source = candidate.source === 'ai' || candidate.source === 'user' || candidate.source === 'auto'
    ? candidate.source
    : 'ai'

  return {
    detected,
    disabled,
    source,
    confidence: clampConfidence(typeof candidate.confidence === 'number' ? candidate.confidence : detected ? 70 : 0),
    eventTypes: normalizeStringArray(candidate.eventTypes ?? candidate.event_types ?? candidate.types),
    trigger: nullableString(candidate.trigger ?? candidate.triggerCondition ?? candidate.trigger_condition),
    branches: normalizeStringArray(candidate.branches ?? candidate.branchRules ?? candidate.branch_rules),
    sequence: normalizeSequence(candidate.sequence ?? candidate.flow ?? candidate.steps),
    assets: normalizeStringArray(candidate.assets ?? candidate.resources ?? candidate.resourceList ?? candidate.resource_list),
    layers: normalizeStringArray(candidate.layers ?? candidate.layerRules ?? candidate.layer_rules),
    controls: normalizeStringArray(candidate.controls ?? candidate.controlRules ?? candidate.control_rules),
    endState: nullableString(candidate.endState ?? candidate.end_state),
    openQuestions: normalizeStringArray(candidate.openQuestions ?? candidate.open_questions ?? candidate.questions),
    prototypeNotes: normalizeStringArray(candidate.prototypeNotes ?? candidate.prototype_notes ?? candidate.prototype),
    updatedAt: nullableString(candidate.updatedAt ?? candidate.updated_at),
  }
}

export function inferPerformanceSpecFromNode(node: PrdNode): PrdPerformanceSpec | null {
  const text = collectNodeText(node)
  if (!text.trim()) return null

  const matches = SIGNAL_RULES.filter((rule) => rule.pattern.test(text))
  if (!matches.length) return null

  const confidence = clampConfidence(35 + matches.reduce((sum, rule) => sum + rule.weight, 0))
  const sequence = matches.flatMap((rule) => rule.sequence)
  const eventTypes = unique(matches.map((rule) => rule.type), 8)
  const hasSequentialWords = /然后|随后|依次|播完|结束后|阶段|队列/.test(text)
  const hasResultWords = /中奖|jackpot|奖励|成功|完成|解锁|获得|失败|错误/.test(text)

  const openQuestions = unique([
    hasResultWords ? '触发这个表现的结果字段、状态或条件是什么？' : '这个表现由哪个用户动作、系统事件或状态变化触发？',
    ...matches.flatMap((rule) => rule.questions),
    hasSequentialWords ? 'PRD 中提到的“然后/结束后”是否必须严格等待上一段播放完成？' : '完整播放顺序是什么？哪些阶段需要等待上一段完成？',
    '表现资源分别使用哪些特效、音效、图标、弹窗或文案？资源缺失时怎么兜底？',
    '表现播放在哪些层级上：原界面、内容层、HUD、弹窗层、全屏遮罩还是全局特效层？',
    '表现期间能否跳过、打断、重复触发或合并多个结果？',
    '播放完成后界面回到哪里？哪些数值、按钮、列表或状态需要刷新？',
  ], 7)

  return {
    detected: true,
    source: 'auto',
    confidence,
    eventTypes,
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

export function createNoSpecialPerformanceSpec(): PrdPerformanceSpec {
  return {
    detected: false,
    disabled: true,
    source: 'user',
    confidence: 100,
    eventTypes: [],
    trigger: null,
    branches: [],
    sequence: [],
    assets: [],
    layers: [],
    controls: [],
    endState: null,
    openQuestions: [],
    prototypeNotes: [],
    updatedAt: new Date().toISOString(),
  }
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
  if (spec.disabled) return '## 表现编排\n\n已标记为无特殊表现；该节点只按基础 UI/状态说明交付。'
  if (!spec.detected) return ''

  const lines = [
    '## 表现编排',
    '',
    `**识别来源：** ${spec.source === 'auto' ? '系统自动扫描' : spec.source === 'ai' ? 'AI 打磨' : '用户确认'}`,
    `**置信度：** ${spec.confidence}%`,
    spec.eventTypes.length ? `**表现类型：** ${spec.eventTypes.join('、')}` : null,
    '',
    '### 触发条件',
    '',
    spec.trigger ?? '待确认。',
  ].filter((line): line is string => line !== null)

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
