import type { PrdPerformanceSequenceStep, PrdPerformanceSlotKey } from '../types/prdNode'

export interface PlatformMotionIntegrationMode {
  id: string
  label: string
  keywords: RegExp
  designerQuestions: string[]
  slotPriority?: PrdPerformanceSlotKey[]
}

export interface PlatformMotionRule {
  type: string
  weight: number
  pattern: RegExp
  integrationModes: string[]
  sequence: PrdPerformanceSequenceStep[]
  questions: string[]
  slotPriority?: PrdPerformanceSlotKey[]
  assets?: string[]
  layers?: string[]
  controls?: string[]
  prototypeNotes?: string[]
}

export const PLATFORM_MOTION_INTEGRATION_MODES: PlatformMotionIntegrationMode[] = [
  {
    id: 'tween-transform',
    label: '平台动效变换',
    keywords: /tween|Tween|位移|移动|飞入|飞出|缩放|弹出|收起|旋转|闪烁|缓动|贝塞尔|曲线|position|scale|easing/i,
    designerQuestions: [
      '这个动效需要由程序控制位置、缩放或旋转吗？请确认起点、终点、时长和缓动。',
      '如果是飞行动效，路径是直线、抛物线、贝塞尔曲线，还是跟随设计稿指定轨迹？',
    ],
    slotPriority: ['sequence', 'controls', 'endState'],
  },
  {
    id: 'ui-opacity',
    label: '透明度淡入淡出',
    keywords: /透明|淡入|淡出|显隐|opacity|UIOpacity|遮罩|渐显|渐隐/i,
    designerQuestions: [
      '透明度从多少到多少？与位移/缩放是同步播放还是错峰播放？',
      '淡出结束后节点是隐藏、销毁、回收到对象池，还是保留等待复用？',
    ],
    slotPriority: ['sequence', 'endState', 'controls'],
  },
  {
    id: 'animation-clip',
    label: '平台动画资源',
    keywords: /AnimationClip|cc\.Animation|\.anim|动画剪辑|帧动画|playOnLoad|Animation\b/i,
    designerQuestions: [
      '这段动效是否已有可复用动画资源？请给出资源名称、是否自动播放和循环方式。',
      '动画资源播完后是否需要派发事件、切状态或继续播放下一段程序动效？',
    ],
    slotPriority: ['assets', 'sequence', 'endState'],
  },
  {
    id: 'spine-skeleton',
    label: 'Spine/Skeleton',
    keywords: /spine|Skeleton|sp\.Skeleton|骨骼|skeleton|setAnimation|addAnimation|皮肤|skin/i,
    designerQuestions: [
      'Spine 资源名、动画名、皮肤名是什么？是否有 loop、out、idle 等多段动画？',
      'Spine 播放完成后是否必须等待回调，再进入弹窗、数值刷新或收尾动效？',
    ],
    slotPriority: ['assets', 'sequence', 'endState'],
  },
  {
    id: 'particle',
    label: '粒子/特效资源',
    keywords: /ParticleSystem|ParticleSystem2D|粒子|光效|喷金币|拖尾|爆点|resetSystem|stopSystem/i,
    designerQuestions: [
      '粒子是跟随对象飞行、在固定层级爆发，还是作为背景循环？',
      '资源缺失或低性能模式下，粒子是否降级为静态光效或直接跳过？',
    ],
    slotPriority: ['layers', 'controls', 'assets'],
  },
  {
    id: 'prefab-effect',
    label: '组件/弹窗特效',
    keywords: /Prefab|prefab|预制体|弹窗|面板|toast|notify|提示|instantiate|对象池|回收/i,
    designerQuestions: [
      '这个表现由哪个组件或弹窗承载？挂载到哪个 layer，是否需要对象池或组件复用？',
      '组件的入场、停留、关闭和销毁/回收时机分别是什么？',
    ],
    slotPriority: ['assets', 'layers', 'endState'],
  },
  {
    id: 'sequence-frame',
    label: '序列帧',
    keywords: /SequenceFrame|序列帧|逐帧|帧率|spriteFrames|SpriteFrame/i,
    designerQuestions: [
      '序列帧素材帧率、播放次数、首帧/末帧停留规则是什么？',
      '序列帧与飞行、粒子或 Spine 的先后关系是什么？',
    ],
    slotPriority: ['assets', 'sequence', 'endState'],
  },
  {
    id: 'audio-sync',
    label: '音效联动',
    keywords: /AudioClip|AudioSource|音效|声音|BGM|playAudio|PlaySound|stopAudio|StopSound|提示音/i,
    designerQuestions: [
      '每段动效对应哪个音效？音效在阶段开始、爆点还是结束时触发？',
      '动效被跳过、打断或重复触发时，音效需要停止、叠加还是防重？',
    ],
    slotPriority: ['assets', 'sequence', 'controls'],
  },
]

export const PLATFORM_MOTION_RULES: PlatformMotionRule[] = [
  {
    type: '结果/奖励表现',
    weight: 28,
    pattern: /中奖|jackpot|bigwin|bonus|free|抽中|抽奖|奖励|大奖|命中奖励|获得奖励|掉落|开箱|结算奖励|权益解锁|解锁奖励/i,
    integrationModes: ['Spine/Skeleton', '组件/弹窗特效', '音效联动', '平台动效变换'],
    sequence: [
      { title: '结果锁定', detail: '结果返回后先冻结当前演出对象，避免重复触发或提前刷新最终奖励。', layer: '逻辑结果层' },
      { title: '主结果表现', detail: '播放中奖、获得、解锁、Jackpot 或达成表现，确认不同结果等级是否分支。', layer: '主表现层' },
    ],
    questions: [
      '这个结果由哪个字段或条件决定？不同等级是否播放不同 Spine/组件特效/音效？',
      '如果同时命中多个结果，主表现优先级如何排序？',
    ],
    slotPriority: ['branches', 'assets', 'sequence', 'controls', 'endState'],
    assets: ['中奖/结果主特效', '奖励图标或结果标题', '结果音效'],
    layers: ['主表现层', '结果展示层', '弹窗层'],
    controls: ['表现播放期间是否允许再次触发同类事件待确认'],
    prototypeNotes: ['原型需要展示结果锁定、主表现爆点和结果确认三个阶段。'],
  },
  {
    type: '金币/数值获得',
    weight: 26,
    pattern: /金币|coin|gold|钻石|宝石|积分|货币|资产|余额|数量|数值|金额|score|point|reward amount|飞币|飞行|收集|collect|token/i,
    integrationModes: ['平台动效变换', '透明度淡入淡出', '粒子/特效资源', '序列帧', '音效联动'],
    sequence: [
      { title: '数值揭示', detail: '展示获得的金币、宝石、积分或金额，确认是直接显示还是滚动到最终值。', layer: '数值层' },
      { title: '资产飞入', detail: '播放金币/图标沿指定路径飞入资产栏，可串联拖尾、粒子、序列帧和提示音。', layer: 'HUD 资产层' },
      { title: '最终刷新', detail: '飞入结束后刷新最终资产值，并确认是否回收飞行组件或对象。', layer: '数据展示层' },
    ],
    questions: [
      '金币/资产飞入的起点、终点、数量、间隔、路径、缩放和透明度规则是什么？',
      '飞入结束后刷新最终数值是在第一枚、最后一枚还是所有粒子结束后？',
      '数值是直接出现、滚动增长，还是先隐藏再揭晓？',
    ],
    slotPriority: ['sequence', 'endState', 'assets', 'controls', 'layers'],
    assets: ['金币/资产图标', '数值滚动组件', '飞入粒子或拖尾', '收集音效'],
    layers: ['数值层', 'HUD 资产层', 'UIEffect 层'],
    controls: ['数值滚动和飞入期间是否可跳过、打断或合并待确认'],
    prototypeNotes: ['原型需要做出数字滚动、分批飞入和资产刷新时机。'],
  },
  {
    type: '连线/命中表现',
    weight: 22,
    pattern: /连线|命中线|中奖线|line|棋盘|格子|组合|消除|匹配|高亮线|命中区域|bet area|下注区/i,
    integrationModes: ['平台动效变换', 'Spine/Skeleton', '粒子/特效资源', '音效联动'],
    sequence: [
      { title: '命中区域标记', detail: '高亮命中的线、格子、下注区或组合区域，确认逐条播放还是同时播放。', layer: '棋盘/内容层' },
      { title: '命中特效', detail: '在命中区域播放对应特效，确认是否等待该特效播完再进入下一阶段。', layer: '特效层' },
    ],
    questions: [
      '连线/命中区域是逐条播放还是所有命中项同时播放？',
      '命中特效播放完成后是否必须等待，再进入弹窗或奖励表现？',
    ],
    slotPriority: ['sequence', 'endState', 'assets', 'layers'],
    assets: ['连线高亮特效', '命中区域特效', '命中音效'],
    layers: ['棋盘/内容层', '特效层'],
    prototypeNotes: ['原型需要把命中区域和后续表现的先后关系做出来。'],
  },
  {
    type: '道具/图标特效',
    weight: 18,
    pattern: /宝石|gem|图标|icon|符石|道具|碎片|item|magic|dice|card|poker|chess|道具特效|图标特效/i,
    integrationModes: ['Spine/Skeleton', '平台动效变换', '组件/弹窗特效', '音效联动'],
    sequence: [
      { title: '对象特效', detail: '在命中的宝石、图标、骰子、卡牌或道具上播放专属特效，确认资源名和替换规则。', layer: '对象特效层' },
    ],
    questions: [
      '不同道具、图标或结果对象是否使用不同特效资源？资源命名或映射规则是什么？',
      '对象特效是在原位置播放，还是复制到独立表现层播放？',
    ],
    slotPriority: ['assets', 'layers', 'sequence'],
    assets: ['对象专属特效', '道具/图标资源', '道具音效'],
    layers: ['对象特效层', 'UIEffect 层'],
    prototypeNotes: ['原型需要标注哪个对象触发了哪类特效。'],
  },
  {
    type: '弹窗/揭晓表现',
    weight: 24,
    pattern: /弹窗|popup|modal|面板|揭晓|展开|弹出|关闭|收起|结果窗|奖励窗|toast|notify|提示/i,
    integrationModes: ['组件/弹窗特效', '平台动画资源', '透明度淡入淡出', '音效联动'],
    sequence: [
      { title: '弹窗入场', detail: '结果弹窗或提示层入场，确认展开方向、遮罩、是否全屏以及入场前置特效。', layer: '弹窗层' },
      { title: '确认与关闭', detail: '弹窗停留、自动关闭或等待用户点击关闭，确认关闭后是否继续播放收尾表现。', layer: '弹窗层' },
    ],
    questions: [
      '弹窗是自动关闭还是必须用户点击关闭？如果自动关闭，关闭前停留多久？',
      '弹窗入场前是否需要先播特效？关闭后是否还有收尾特效？',
    ],
    slotPriority: ['controls', 'sequence', 'endState', 'layers'],
    assets: ['弹窗 Prefab/面板', '遮罩', '入场/关闭特效', '提示音'],
    layers: ['弹窗层', '遮罩层', 'Dialog 层'],
    controls: ['弹窗展示期间是否允许跳过、关闭或重复点击待确认'],
    prototypeNotes: ['原型需要模拟弹窗入场、停留和关闭后的状态回落。'],
  },
  {
    type: '阶段演出/特效队列',
    weight: 26,
    pattern: /播放|特效|粒子|光效|音效|震屏|震动|动画|动效|展开|滚动|闪烁|高亮|飞入|播完|结束后|然后|随后|依次|阶段|队列|loop|out|idle/i,
    integrationModes: ['平台动效变换', 'Spine/Skeleton', '粒子/特效资源', '平台动画资源', '音效联动'],
    sequence: [
      { title: '前置表现', detail: '播放前置光效、音效、震屏或高亮，用来承接事件发生。', layer: '全局特效层' },
      { title: '队列推进', detail: '按阶段播放展开、滚动、主特效和收尾特效，确认每段是否等待上一段完成。', layer: '表现队列' },
    ],
    questions: [
      '完整播放顺序是什么？哪些阶段必须等上一个特效播完？',
      'Spine、粒子、Tween 和音效分别在哪个阶段触发？是否存在资源缺失时的兜底表现？',
    ],
    slotPriority: ['sequence', 'integrationModes', 'assets', 'controls'],
    assets: ['粒子/光效', '音效', '震屏参数', 'Spine/AnimationClip'],
    layers: ['全局特效层', '表现队列', 'UIEffect 层'],
    controls: ['表现队列是否可被跳过、打断、合并或重播待确认'],
    prototypeNotes: ['原型需要用分阶段时间线表达播放顺序，而不是只画静态最终态。'],
  },
  {
    type: '成功/完成反馈',
    weight: 16,
    pattern: /成功|完成|达成|提交成功|支付成功|上传完成|生成完成|领取成功|强化成功|升级成功/i,
    integrationModes: ['组件/弹窗特效', '透明度淡入淡出', '音效联动'],
    sequence: [
      { title: '完成反馈', detail: '展示成功、完成、达成或已生成的明确反馈。', layer: '反馈层' },
      { title: '后续引导', detail: '表现结束后引导用户继续、查看详情、使用结果或返回原界面。', layer: '操作层' },
    ],
    questions: [
      '完成反馈结束后，用户下一步是关闭、查看详情、继续操作还是跳转？',
      '成功反馈是否需要和奖励、权益或数值变化串联播放？',
    ],
    slotPriority: ['endState', 'sequence', 'controls'],
    assets: ['成功图标/完成态素材', '完成提示音'],
    layers: ['反馈层', '操作层'],
  },
  {
    type: '失败/风险提示',
    weight: 16,
    pattern: /失败|错误|异常|风险|警告|扣除|损失|强化失败|未命中|空奖|未中奖|error|warning|network|弱网|断线/i,
    integrationModes: ['组件/弹窗特效', '透明度淡入淡出', '音效联动'],
    sequence: [
      { title: '异常提示', detail: '展示失败、风险、错误、弱网或未命中的结果提示，确认是否需要弱化或强调。', layer: '反馈层' },
      { title: '恢复路径', detail: '提示用户重试、补足条件、返回或查看原因。', layer: '操作层' },
    ],
    questions: [
      '失败或风险提示结束后，用户可以重试、返回还是必须确认？',
      '是否需要展示原因、损失、补偿或下一步解决路径？',
    ],
    slotPriority: ['endState', 'controls', 'assets'],
    assets: ['失败/警告图标', '错误提示音', '网络状态文案'],
    layers: ['反馈层', '操作层'],
  },
]
