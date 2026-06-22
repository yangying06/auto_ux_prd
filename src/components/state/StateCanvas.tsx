import { PrototypeBoard } from './PrototypeBoard'
import { StateCard } from './StateCard'
import type { PrototypeVersion } from '../../store/appStore'
import type { RagSearchResult } from '../../types/chat'
import type { AssetDependency, UXRequirementState } from '../../types/uxRequirement'

interface StateCanvasProps {
  requirement: UXRequirementState
  latestRag: RagSearchResult | null
  projectName: string
  prototypeHtml: string | null
  prototypeHistory: PrototypeVersion[]
  isGeneratingPrototype: boolean
  isExportingPrompt: boolean
  onGeneratePrototype: (instruction?: string) => void
  onRestorePrototype: (id: string) => void
  onClearPrototypeHistory: () => void
  onExportPrompt: () => void
  onOpenBolt: () => void
}

function hasMissingAsset(assets: AssetDependency[]) {
  return assets.some((asset) => !asset.is_ready || !asset.path)
}

function formatAssets(assets: AssetDependency[]) {
  return assets
    .map((asset) => `${asset.type}: ${asset.path ?? '[缺失路径]'}`)
    .join(' · ')
}

function RequirementTree({ requirement, missingAsset }: { requirement: UXRequirementState; missingAsset: boolean }) {
  const items = [
    {
      title: '触发条件',
      value: requirement.trigger_condition,
      fallback: requirement.missing_reasons.trigger_condition ?? '等待补充玩家行为、目标节点和触发时机',
      done: Boolean(requirement.trigger_condition),
      children: requirement.trigger_condition ? ['玩家/系统触发入口已识别'] : ['需要明确触发来源'],
    },
    {
      title: '资源依赖',
      value: requirement.asset_dependencies.length ? formatAssets(requirement.asset_dependencies) : null,
      fallback: requirement.missing_reasons.asset_dependencies ?? '等待补充图片、预制体、音效或特效资源',
      done: !missingAsset && requirement.asset_dependencies.length > 0,
      children: requirement.asset_dependencies.length
        ? requirement.asset_dependencies.map((asset) => `${asset.type}: ${asset.path ?? '缺少路径'}`)
        : ['可通过左侧附件添加参考图或界面素材'],
    },
    {
      title: '执行规则',
      value: requirement.sequence_rules,
      fallback: requirement.missing_reasons.sequence_rules ?? '等待补充动画、反馈和状态变化顺序',
      done: Boolean(requirement.sequence_rules),
      children: requirement.sequence_rules ? ['交互时序可用于生成原型'] : ['需要明确执行顺序'],
    },
    {
      title: '平台实现建议',
      value: requirement.engine_constraints,
      fallback: requirement.missing_reasons.engine_constraints ?? '等待目标平台实现约束',
      done: Boolean(requirement.engine_constraints),
      children: requirement.engine_constraints ? ['平台实现建议已纳入'] : ['可由项目知识检索补齐'],
    },
  ]

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container">
      <div className="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-high/60 px-md py-sm">
        <span className="font-mono text-label-sm uppercase text-secondary">需求拆解树</span>
        <span className="font-mono text-[10px] text-on-surface-variant">完成度 {requirement.completion_rate}%</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-md">
        <div className="mb-sm font-mono text-code-sm text-on-surface">UX 需求</div>
        <div className="ml-sm border-l border-outline-variant/30 pl-md">
          {items.map((item) => (
            <div key={item.title} className="relative pb-md last:pb-0">
              <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full border border-outline-variant/50 bg-surface-container-high" />
              <div className="flex items-start gap-sm">
                <span className={item.done ? 'mt-0.5 font-mono text-[10px] text-tertiary' : 'mt-0.5 font-mono text-[10px] text-error'}>
                  {item.done ? '已完成' : '待补充'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-label-sm text-on-surface">{item.title}</div>
                  <p className="mt-xs line-clamp-2 text-body-sm text-on-surface-variant">{item.value ?? item.fallback}</p>
                  <div className="mt-xs ml-sm border-l border-outline-variant/20 pl-sm">
                    {item.children.map((child, index) => (
                      <div key={`${item.title}-${index}`} className="font-mono text-[10px] text-on-surface-variant/70">└ {child}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function StateCanvas({
  requirement,
  latestRag,
  projectName,
  prototypeHtml,
  prototypeHistory,
  isGeneratingPrototype,
  isExportingPrompt,
  onGeneratePrototype,
  onRestorePrototype,
  onClearPrototypeHistory,
  onExportPrompt,
  onOpenBolt,
}: StateCanvasProps) {
  const missingAsset = hasMissingAsset(requirement.asset_dependencies)
  const progressWidth = `${requirement.completion_rate}%`
  const canGeneratePrototype = requirement.completion_rate >= 60
  const canExport = requirement.completion_rate >= 60

  return (
    <main className="relative flex h-full w-[65%] flex-col bg-surface-container-lowest">
      <div className="blueprint-grid pointer-events-none absolute inset-0 z-0" />

      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-outline-variant/20 bg-surface-container-lowest/80 px-xl py-md backdrop-blur-md">
        <div className="flex items-center gap-md">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container font-mono text-primary">
            TREE
          </div>
          <div>
            <h2 className="text-headline-sm font-semibold text-on-surface">UX 需求状态看板</h2>
            <span className="mt-xs flex items-center gap-xs font-mono text-label-md uppercase text-on-surface-variant">
              项目：{projectName}
            </span>
          </div>
        </div>

        <div className="mx-lg flex max-w-[300px] flex-1 flex-col gap-xs">
          <div className="flex justify-between font-mono text-code-sm">
            <span className="text-on-surface-variant">生成进度</span>
            <span className="text-tertiary">{requirement.completion_rate}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
            <div className="relative h-full rounded-full bg-tertiary" style={{ width: progressWidth }}>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-sm">
          {canGeneratePrototype ? (
            <button
              onClick={() => onGeneratePrototype()}
              disabled={isGeneratingPrototype}
              className="rounded-lg border border-secondary/30 bg-secondary/10 px-lg py-sm font-mono text-label-md uppercase text-secondary transition-colors hover:bg-secondary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGeneratingPrototype ? '生成中...' : prototypeHtml ? '更新原型' : '生成原型'}
            </button>
          ) : null}
          {canExport ? (
            <button
              onClick={onExportPrompt}
              disabled={isExportingPrompt}
              className="rounded-lg border border-primary/30 bg-primary/10 px-lg py-sm font-mono text-label-md uppercase text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExportingPrompt ? '导出中...' : '导出最终规格'}
            </button>
          ) : (
            <button disabled className="rounded-lg border border-primary/20 bg-primary/10 px-lg py-sm font-mono text-label-md uppercase text-primary opacity-50">
              导出最终规格
            </button>
          )}
          <button
            onClick={onOpenBolt}
            disabled={!prototypeHtml && requirement.completion_rate < 60}
            title={!prototypeHtml && requirement.completion_rate < 60 ? '需求完成度达到 60% 后可验证' : '在 bolt.new 中验证原型'}
            className="rounded-lg border border-tertiary/30 bg-tertiary/10 px-lg py-sm font-mono text-label-md uppercase text-tertiary transition-colors hover:bg-tertiary/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Bolt 验证
          </button>
        </div>
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(280px,0.42fr)_minmax(360px,0.58fr)] gap-lg overflow-hidden p-lg max-xl:grid-cols-1 max-xl:overflow-auto">
        <div className="flex min-h-0 flex-col gap-lg">
          <RequirementTree requirement={requirement} missingAsset={missingAsset} />

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="mb-sm flex items-center gap-xs">
              <span className="font-mono text-label-md uppercase text-on-surface-variant">逻辑状态节点</span>
            </div>
            <div className="flex-1 overflow-auto pb-4">
              <div className="flex min-w-0 flex-row flex-wrap items-start gap-lg px-xs pt-md">

              <StateCard
                title="触发条件"
                label={requirement.trigger_condition ? '[事件] 已确认' : '缺少触发条件'}
                body={requirement.trigger_condition ?? '需要明确玩家行为、目标节点和触发时机。'}
                tone={requirement.trigger_condition ? 'complete' : 'missing'}
                confidence={requirement.slot_confidence.trigger_condition}
                missingReason={requirement.missing_reasons.trigger_condition}
              />

              <StateCard
                title="资源路径"
                label={missingAsset ? '缺少资源路径' : '[资产] 已确认'}
                body={missingAsset ? (requirement.asset_dependencies.length === 0 ? '尚未确认任何资源依赖。' : '部分资源路径待确认。') : formatAssets(requirement.asset_dependencies)}
                tone={missingAsset ? 'missing' : 'complete'}
                meta={requirement.asset_dependencies.length > 0 ? formatAssets(requirement.asset_dependencies) : undefined}
                inputPlaceholder={missingAsset ? '在左侧回复或在此粘贴路径...' : undefined}
                confidence={requirement.slot_confidence.asset_dependencies}
                missingReason={requirement.missing_reasons.asset_dependencies}
              />

              <StateCard
                title="执行规则"
                label={requirement.sequence_rules ? '[时序] 已确认' : '缺少执行规则'}
                body={requirement.sequence_rules ?? '需要明确多目标排序、动画队列和震动反馈的时序关系。'}
                tone={requirement.sequence_rules ? 'complete' : 'missing'}
                confidence={requirement.slot_confidence.sequence_rules}
                missingReason={requirement.missing_reasons.sequence_rules}
              />

              {requirement.engine_constraints ? (
                <StateCard
                  title="平台实现建议"
                  label="项目知识"
                  body={requirement.engine_constraints}
                  tone="info"
                  meta={latestRag?.references.map((reference) => reference.source).join(' · ') ?? '参考：当前项目知识'}
                  confidence={requirement.slot_confidence.engine_constraints}
                  missingReason={requirement.missing_reasons.engine_constraints}
                />
              ) : null}

              {requirement.next_question ? (
                <StateCard
                  title="下一步问题"
                  label="[下一问]"
                  body={requirement.next_question}
                  tone="info"
                  meta="Claude 应优先围绕这一问题继续追问。"
                />
              ) : null}

              {latestRag ? (
                <StateCard
                  title="项目知识参考"
                  label={latestRag.status === 'connected' ? '[检索] 已连接' : '[检索] 失败'}
                  body={latestRag.answer}
                  tone={latestRag.status === 'connected' ? 'info' : latestRag.status === 'error' ? 'missing' : 'info'}
                  meta={latestRag.references.map((reference) => `${reference.title}: ${reference.source}`).join(' · ')}
                />
              ) : null}
            </div>
          </div>
        </section>
        </div>

        <PrototypeBoard
          html={prototypeHtml}
          history={prototypeHistory}
          isLoading={isGeneratingPrototype}
          onRestore={onRestorePrototype}
          onClearHistory={onClearPrototypeHistory}
        />
      </div>
    </main>
  )
}
