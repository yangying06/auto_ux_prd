interface FigmaFlowFrameEvidence {
  id?: string | null
  name?: string | null
  visibleTexts?: string[] | null
  annotations?: string[] | null
  interactionTips?: string[] | null
}

interface FigmaFlowGroupEvidence {
  label: string
  frames: FigmaFlowFrameEvidence[]
}

export interface FigmaRelationSemanticsInput {
  connectorName: string
  connectorId: string
  connectorBounds?: string | null
  sourceGroup: FigmaFlowGroupEvidence
  targetGroup: FigmaFlowGroupEvidence
  sourceFrame?: FigmaFlowFrameEvidence | null
  targetFrame?: FigmaFlowFrameEvidence | null
  direction: string
  sourcePoint: string
  targetPoint: string
  fallbackLabel?: string | null
  fallbackReason?: string | null
}

export interface FigmaRelationAnalysis {
  trigger: string
  effect: string
  targetMeaning: string
  specImplications: string[]
  openQuestions: string[]
}

function compactText(value: string | null | undefined, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function uniqueTexts(values: Array<string | null | undefined>, maxItems = 8) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = compactText(value)
    const key = text.toLocaleLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function stripInteractionTipPrefix(text: string) {
  return compactText(text)
    .replace(/^(Interaction\s*tips?|Tips?)\s*[:：-]?\s*/iu, '')
    .replace(/^交互提示\s*[:：-]?\s*/u, '')
    .replace(/^提示\s*[:：-]?\s*/u, '')
    .replace(/[~～]+$/u, '')
    .trim()
}

function localizeCommonEnglishTip(text: string) {
  let next = text
    .replace(/\blong\s*press\b/igu, '长按')
    .replace(/\bpress\s+and\s+hold\b/igu, '长按')
    .replace(/\btap\b|\bclick\b/igu, '点击')
    .replace(/\bpress\b/igu, '按压')
    .replace(/\bthe\s+gift\b|\bgift\b/igu, '礼物')
    .replace(/\bto\s+preview\s+it\b/igu, '可预览')
    .replace(/\bpreview\s+it\b/igu, '预览')
    .replace(/\bpreview\b/igu, '预览')
    .replace(/\bopen\b|\bshow\b/igu, '打开')
    .replace(/\bnavigate\s+to\b|\bjump\s+to\b|\bgo\s+to\b/igu, '进入')
    .replace(/\bconfirm\b/igu, '确认')
    .replace(/\bcancel\b/igu, '取消')
    .replace(/\bclose\b/igu, '关闭')
  next = next
    .replace(/\s+/g, '')
    .replace(/长按礼物可预览/u, '长按礼物可预览')
    .replace(/点击礼物可预览/u, '点击礼物可预览')
  return next
}

export function normalizeFigmaInteractionTipText(text: string | null | undefined) {
  const stripped = stripInteractionTipPrefix(String(text ?? ''))
  if (!stripped) return ''
  const localized = /[a-z]/iu.test(stripped) ? localizeCommonEnglishTip(stripped) : stripped
  return compactText(localized, 80)
}

export function formatFigmaInteractionTipRequirement(text: string | null | undefined) {
  const normalized = normalizeFigmaInteractionTipText(text)
  return normalized ? `交互提示：${normalized}` : ''
}

function frameTips(frame: FigmaFlowFrameEvidence | null | undefined) {
  if (!frame) return []
  const explicitTips = frame.interactionTips ?? []
  const annotationTips = (frame.annotations ?? []).filter((text) => /^(Interaction\s*tips?|Tips?|交互提示|提示)\s*[:：-]?/iu.test(text))
  return uniqueTexts([...explicitTips, ...annotationTips]
    .map((text) => formatFigmaInteractionTipRequirement(text)), 6)
}

function groupTips(group: FigmaFlowGroupEvidence) {
  return uniqueTexts(group.frames.flatMap((frame) => frameTips(frame)), 10)
}

function relationFrameTexts(frame: FigmaFlowFrameEvidence | null | undefined) {
  if (!frame) return []
  return uniqueTexts([
    frame.name,
    ...(frame.visibleTexts ?? []),
    ...(frame.annotations ?? []),
    ...frameTips(frame),
  ], 16)
}

function relationGroupTexts(group: FigmaFlowGroupEvidence) {
  return uniqueTexts(group.frames.flatMap((frame) => relationFrameTexts(frame)), 24)
}

function cleanActionText(value: string | null | undefined, maxLength = 32) {
  const normalized = normalizeFigmaInteractionTipText(value) || compactText(value, maxLength)
  return compactText(normalized
    .replace(/^(?:交互提示|提示|文案)\s*[:：-]?\s*/u, '')
    .replace(/[。；;，,]\s*$/u, '')
    .trim(), maxLength)
}

function firstActionText(values: Array<string | null | undefined>) {
  return uniqueTexts(values, 12)
    .find((text) => /点击|长按|按压|打开|进入|跳转|预览|确认|取消|关闭|提交|选择|返回|tap|click|press|preview|open|show|confirm|cancel|close/iu.test(text))
    ?? ''
}

function relationEvidenceText(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame'>) {
  return uniqueTexts([
    input.sourceGroup.label,
    input.targetGroup.label,
    ...relationFrameTexts(input.sourceFrame),
    ...relationGroupTexts(input.sourceGroup),
    ...relationFrameTexts(input.targetFrame),
    ...relationGroupTexts(input.targetGroup),
  ], 40).join(' ')
}

function hasMaterialIpConstraint(text: string) {
  return /版权|授权|IP|ip|logo|商标|形象|素材|资源|图片|icon|图标|字体/u.test(text)
}

function compactTargetLabel(label: string) {
  return compactText(label.replace(/界面$/u, ''), 16)
}

function inferTargetMeaning(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame'>) {
  const relationText = relationEvidenceText(input)
  if (hasMaterialIpConstraint(relationText)) {
    return '这条关系受素材与版权/IP约束，需要明确形象、Logo、授权素材的使用范围和兜底规则'
  }

  const texts = relationGroupTexts(input.targetGroup)
  const targetTexts = uniqueTexts([...relationFrameTexts(input.targetFrame), ...texts], 24)
  const haystack = `${input.targetGroup.label} ${targetTexts.join(' ')}`
  if (hasMaterialIpConstraint(haystack)) {
    return '目标界面承接素材与版权/IP约束，需要明确形象、Logo、授权素材的使用范围和兜底规则'
  }
  if (/(没|未|无).{0,8}创建|空状态|空态|第一个|暂无|empty/iu.test(haystack)) {
    return '目标界面是首次使用/空态承接页，需要提供创建入口、空态说明和下一步行动'
  }
  if (/生成中|加载|处理中|等待|loading|进度/u.test(haystack)) {
    return '目标界面是处理中状态，需要定义等待反馈、超时和完成后的去向'
  }
  if (/成功|完成|提交成功|领取成功|complete|success/iu.test(haystack)) {
    return '目标界面是成功结果页，需要定义结果展示、确认动作和后续返回路径'
  }
  if (/失败|错误|异常|审核失败|error|fail/iu.test(haystack)) {
    return '目标界面是失败/异常状态，需要定义错误原因、重试入口和可恢复路径'
  }
  if (/预览|查看|效果|详情|preview|detail/iu.test(haystack)) {
    return '目标界面用于查看或预览结果，需要定义展示内容、可操作项和退出方式'
  }
  if (/创建|生成|输入|编辑|填写|配置|表单|create|generate|edit|input/iu.test(haystack)) {
    return '目标界面是创建/编辑流程承接页，需要定义输入项、校验规则和提交条件'
  }
  return `目标界面为「${input.targetGroup.label}」，需要承接前一界面的跳转结果并明确可继续操作`
}

function inferSpecImplications(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame'>, trigger: string, targetMeaning: string) {
  const sourceTexts = uniqueTexts([...relationFrameTexts(input.sourceFrame), ...relationGroupTexts(input.sourceGroup)], 24)
  const targetTexts = uniqueTexts([...relationFrameTexts(input.targetFrame), ...relationGroupTexts(input.targetGroup)], 24)
  const haystack = `${trigger} ${sourceTexts.join(' ')} ${targetTexts.join(' ')} ${targetMeaning}`
  const implications = [
    `源界面需要把「${trigger}」定义为可执行入口，并说明触发后的加载、跳转或状态变化`,
    targetMeaning,
  ]
  if (hasMaterialIpConstraint(haystack)) {
    implications.push('交付规格需要列出素材依赖、版权/IP限制、Logo展示规则、缺失素材时的降级方案')
  }
  if (/预览|查看|效果|preview/iu.test(haystack)) {
    implications.push('需要定义预览内容来源、预览触发手势、关闭/返回方式，以及预览失败时的反馈')
  }
  if (/创建|生成|输入|编辑|填写|配置|create|generate|edit|input/iu.test(haystack)) {
    implications.push('需要定义创建/编辑所需字段、默认值、校验错误和提交后的目标状态')
  }
  return uniqueTexts(implications, 6)
}

function inferOpenQuestions(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame'>, trigger: string) {
  const sourceHasAction = Boolean(firstActionText([
    ...relationFrameTexts(input.sourceFrame),
    ...relationGroupTexts(input.sourceGroup),
  ]))
  const questions: string[] = []
  if (!sourceHasAction || trigger.startsWith('进入')) {
    questions.push('源界面缺少明确触发控件或手势，需要确认这条关系由用户操作、系统自动跳转还是流程顺序产生')
  }
  const relationText = relationEvidenceText(input)
  if (hasMaterialIpConstraint(relationText)) {
    questions.push('版权/IP素材的校验时机、失败兜底和责任边界仍需确认')
  }
  return uniqueTexts(questions, 4)
}

function inferFallbackTrigger(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame' | 'fallbackLabel'>) {
  const target = compactTargetLabel(input.targetGroup.label)
  const relationText = relationEvidenceText(input)
  if (hasMaterialIpConstraint(relationText)) return `版权/IP校验后进入${target}`
  if (/生成中|加载|处理中|等待|loading|进度/u.test(relationText)) return `处理完成后进入${target}`
  if (/成功|完成|提交成功|领取成功|complete|success/iu.test(relationText)) return `成功后进入${target}`
  if (/失败|错误|异常|审核失败|error|fail/iu.test(relationText)) return `失败后进入${target}`
  const fallback = compactText(input.fallbackLabel, 18)
  return fallback && !/^Figma\s*(箭头连接|连接线)/iu.test(fallback)
    ? fallback
    : `进入${target}`
}

export function analyzeFigmaRelation(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame' | 'fallbackLabel'>): FigmaRelationAnalysis {
  const sourceTip = frameTips(input.sourceFrame)[0] ?? groupTips(input.sourceGroup)[0]
  const sourceTipIntent = normalizeFigmaInteractionTipText(sourceTip)
  const sourceAction = firstActionText([
    sourceTipIntent,
    ...relationFrameTexts(input.sourceFrame),
    ...relationGroupTexts(input.sourceGroup),
  ])
  if (sourceAction) {
    const trigger = cleanActionText(sourceAction, 32)
    const relationText = relationEvidenceText(input)
    const isNavigationAction = /点击|长按|按压|打开|进入|跳转|预览|确认|取消|关闭|提交|返回|tap|click|press|preview|open|show|confirm|cancel|close/iu.test(trigger)
    if (hasMaterialIpConstraint(relationText) && !isNavigationAction) {
      const constraintTrigger = inferFallbackTrigger(input)
      const targetMeaning = inferTargetMeaning(input)
      return {
        trigger: constraintTrigger,
        effect: `进入「${input.targetGroup.label}」并承接：${targetMeaning}`,
        targetMeaning,
        specImplications: inferSpecImplications(input, constraintTrigger, targetMeaning),
        openQuestions: inferOpenQuestions(input, constraintTrigger),
      }
    }
    const targetMeaning = inferTargetMeaning(input)
    return {
      trigger,
      effect: `进入「${input.targetGroup.label}」并承接：${targetMeaning}`,
      targetMeaning,
      specImplications: inferSpecImplications(input, trigger, targetMeaning),
      openQuestions: inferOpenQuestions(input, trigger),
    }
  }

  const trigger = inferFallbackTrigger(input)
  const targetMeaning = inferTargetMeaning(input)
  return {
    trigger,
    effect: `进入「${input.targetGroup.label}」并承接：${targetMeaning}`,
    targetMeaning,
    specImplications: inferSpecImplications(input, trigger, targetMeaning),
    openQuestions: inferOpenQuestions(input, trigger),
  }
}

export function deriveFigmaRelationIntent(input: Pick<FigmaRelationSemanticsInput, 'sourceGroup' | 'targetGroup' | 'sourceFrame' | 'targetFrame' | 'fallbackLabel'>) {
  return analyzeFigmaRelation(input).trigger
}

export function formatFigmaRelationLabel(input: FigmaRelationSemanticsInput) {
  return deriveFigmaRelationIntent(input)
}

function frameSummary(label: string, frame: FigmaFlowFrameEvidence | null | undefined) {
  if (!frame) return null
  const texts = uniqueTexts(frame.visibleTexts ?? [], 4).join(' / ')
  const tips = frameTips(frame).join(' / ')
  return [
    `${label}Frame：${frame.name ?? frame.id ?? '未命名'}`,
    frame.id ? `node-id=${frame.id}` : null,
    texts ? `文案=${texts}` : null,
    tips ? `提示=${tips}` : null,
  ].filter(Boolean).join('；')
}

export function formatFigmaRelationReason(input: FigmaRelationSemanticsInput) {
  const analysis = analyzeFigmaRelation(input)
  const sourceTips = groupTips(input.sourceGroup).join(' / ')
  const targetTips = groupTips(input.targetGroup).join(' / ')
  const implications = analysis.specImplications.length ? analysis.specImplications.join('；') : null
  const openQuestions = analysis.openQuestions.length ? analysis.openQuestions.join('；') : null
  return [
    `可用关系：触发「${analysis.trigger}」→ 结果「${analysis.effect}」`,
    `规格含义：${implications}`,
    openQuestions ? `待确认：${openQuestions}` : null,
    `证据链：Figma 连接线「${input.connectorName}」(${input.connectorId})，${input.sourceGroup.label} → ${input.targetGroup.label}`,
    `方向依据：${input.direction}；源端点 ${input.sourcePoint}；目标端点 ${input.targetPoint}`,
    input.connectorBounds ? `范围：${input.connectorBounds}` : null,
    frameSummary('源', input.sourceFrame),
    frameSummary('目标', input.targetFrame),
    sourceTips ? `源界面 tips：${sourceTips}` : null,
    targetTips ? `目标界面 tips：${targetTips}` : null,
    input.fallbackReason,
  ].filter(Boolean).join('。\n')
}

export function formatFigmaInteractionTipsMarkdown(frames: FigmaFlowFrameEvidence[]) {
  const tips = uniqueTexts(frames.flatMap((frame) => frameTips(frame)), 12)
  return tips.length
    ? tips.map((tip) => `- ${tip}`).join('\n')
    : '- 未识别到 Figma interaction tips。'
}
