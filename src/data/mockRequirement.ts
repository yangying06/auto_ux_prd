import type { UXRequirementState } from '../types/uxRequirement'

export const mockRequirement: UXRequirementState = {
  trigger_condition: '玩家点击盘面火圈绿宝石节点时触发金字塔升起表现。',
  sequence_rules: '先锁定输入，再按从下到上的顺序缓慢升起金字塔，同时播放震动反馈。',
  asset_dependencies: [
    {
      type: 'prefab',
      path: 'assets/game/ui/prefabs/UIPyramidList.prefab',
      is_ready: true,
    },
    {
      type: 'effect',
      path: null,
      is_ready: false,
    },
  ],
  engine_constraints: 'Cocos Creator 3.8.8 建议使用 Tween System 串行动画，并将多目标队列封装为 Promise 链，避免并发时序漂移。',
  completion_rate: 60,
  slot_confidence: {
    trigger_condition: 90,
    sequence_rules: 82,
    asset_dependencies: 45,
    engine_constraints: 78,
  },
  missing_reasons: {
    trigger_condition: null,
    sequence_rules: null,
    asset_dependencies: '缺少 fx_Pyramid_appear 的精确资源路径，尚不能进入代码生成。',
    engine_constraints: null,
  },
  next_question: '请补充 fx_Pyramid_appear 特效或音效资源的精确路径。',
}
