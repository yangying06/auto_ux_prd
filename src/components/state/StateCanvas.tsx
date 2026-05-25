import { PrototypeBoard } from './PrototypeBoard'
import { StateCard } from './StateCard'
import type { RagSearchResult } from '../../types/chat'
import type { AssetDependency, UIComponent, UXRequirementState } from '../../types/uxRequirement'

interface StateCanvasProps {
  requirement: UXRequirementState
  latestRag: RagSearchResult | null
  projectName: string
  prototypeHtml: string | null
  isGeneratingPrototype: boolean
  isExportingPrompt: boolean
  onGeneratePrototype: () => void
  onExportPrompt: () => void
}

function hasMissingAsset(assets: AssetDependency[]) {
  return assets.some((asset) => !asset.is_ready || !asset.path)
}

function formatAssets(assets: AssetDependency[]) {
  return assets
    .map((asset) => `${asset.type}: ${asset.path ?? '[缺失路径]'}`)
    .join(' · ')
}

const STATE_COLORS: Record<string, string> = {
  idle: 'bg-outline-variant/30 text-on-surface-variant',
  hover: 'bg-secondary/20 text-secondary',
  pressed: 'bg-tertiary/20 text-tertiary',
  disabled: 'bg-error/10 text-error/60',
  loading: 'bg-primary/20 text-primary',
  active: 'bg-secondary/30 text-secondary',
  error: 'bg-error/20 text-error',
}

function ComponentNode({ component, depth = 0 }: { component: UIComponent; depth?: number }) {
  return (
    <div style={{ paddingLeft: `${depth * 16}px` }}>
      <div className="group flex items-start gap-sm py-xs">
        {/* 连线 + 图标 */}
        <div className="mt-1 flex shrink-0 items-center gap-xs">
          {depth > 0 && <span className="font-mono text-[10px] text-outline-variant/50">└</span>}
          <div className="flex h-5 w-5 items-center justify-center rounded border border-outline-variant/30 bg-surface-container font-mono text-[9px] text-tertiary">
            {component.type.slice(0, 2).toUpperCase()}
          </div>
        </div>
        {/* 内容 */}
        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-xs">
            <span className="font-mono text-label-sm text-on-surface">{component.name}</span>
            <span className="rounded bg-surface-container px-xs font-mono text-[9px] uppercase text-on-surface-variant">{component.type}</span>
            {component.states.map((s) => (
              <span key={s} className={`rounded px-xs font-mono text-[9px] ${STATE_COLORS[s] ?? 'bg-surface-container text-on-surface-variant'}`}>{s}</span>
            ))}
          </div>
          {(component.animation_in || component.animation_out) && (
            <div className="flex gap-sm font-mono text-[10px] text-secondary/70">
              {component.animation_in && <span>↗ {component.animation_in}</span>}
              {component.animation_out && <span>↙ {component.animation_out}</span>}
            </div>
          )}
          {component.notes && (
            <p className="font-body text-[11px] leading-snug text-on-surface-variant/70">{component.notes}</p>
          )}
        </div>
      </div>
      {component.children.map((child, i) => (
        <ComponentNode key={`${child.name}-${i}`} component={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function StateCanvas({ requirement, latestRag, projectName, prototypeHtml, isGeneratingPrototype, isExportingPrompt, onGeneratePrototype, onExportPrompt }: StateCanvasProps) {
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
              Project: {projectName}
            </span>
          </div>
        </div>

        <div className="mx-lg flex max-w-[300px] flex-1 flex-col gap-xs">
          <div className="flex justify-between font-mono text-code-sm">
            <span className="text-on-surface-variant">Generation Progress</span>
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
              onClick={onGeneratePrototype}
              disabled={isGeneratingPrototype}
              className="rounded-lg border border-secondary/30 bg-secondary/10 px-lg py-sm font-mono text-label-md uppercase text-secondary transition-colors hover:bg-secondary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGeneratingPrototype ? 'Generating...' : prototypeHtml ? 'Update Prototype' : 'Generate Prototype'}
            </button>
          ) : null}
          {canExport ? (
            <button
              onClick={onExportPrompt}
              disabled={isExportingPrompt}
              className="rounded-lg border border-primary/30 bg-primary/10 px-lg py-sm font-mono text-label-md uppercase text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExportingPrompt ? 'Exporting...' : 'Export Final Prompt'}
            </button>
          ) : (
            <button disabled className="rounded-lg border border-primary/20 bg-primary/10 px-lg py-sm font-mono text-label-md uppercase text-primary opacity-50">
              Export Final Prompt
            </button>
          )}
        </div>
      </header>

      <div className="relative z-10 flex flex-1 flex-col gap-lg overflow-hidden p-lg">
        <PrototypeBoard html={prototypeHtml} isLoading={isGeneratingPrototype} />

        {/* 组件树面板（借鉴 GDevelop OrchestratorPlan） */}
        {requirement.ui_components.length > 0 && (
          <section className="flex max-h-48 shrink-0 flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container">
            <div className="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-high/60 px-md py-xs">
              <span className="font-mono text-label-sm uppercase text-secondary">界面组件树</span>
              <span className="font-mono text-[10px] text-on-surface-variant">{requirement.ui_components.length} 个根节点</span>
            </div>
            <div className="overflow-auto p-sm">
              {requirement.ui_components.map((comp, i) => (
                <ComponentNode key={`${comp.name}-${i}`} component={comp} depth={0} />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="mb-sm flex items-center gap-xs">
            <span className="font-mono text-label-md uppercase text-on-surface-variant">Logic State Nodes</span>
          </div>
          <div className="flex-1 overflow-auto pb-4">
            <div className="flex min-w-0 flex-row flex-wrap items-start gap-lg px-xs pt-md">

              <StateCard
                title="触发条件"
                label={requirement.trigger_condition ? '[事件] 已确认' : 'Missing Trigger'}
                body={requirement.trigger_condition ?? '需要明确玩家行为、目标节点和触发时机。'}
                tone={requirement.trigger_condition ? 'complete' : 'missing'}
                confidence={requirement.slot_confidence.trigger_condition}
                missingReason={requirement.missing_reasons.trigger_condition}
              />

              <StateCard
                title="资源路径"
                label={missingAsset ? 'Missing Path Reference' : '[资产] 已确认'}
                body={missingAsset ? (requirement.asset_dependencies.length === 0 ? '尚未确认任何资源依赖。' : '部分资源路径待确认。') : formatAssets(requirement.asset_dependencies)}
                tone={missingAsset ? 'missing' : 'complete'}
                meta={requirement.asset_dependencies.length > 0 ? formatAssets(requirement.asset_dependencies) : undefined}
                inputPlaceholder={missingAsset ? '在左侧回复或在此粘贴路径...' : undefined}
                confidence={requirement.slot_confidence.asset_dependencies}
                missingReason={requirement.missing_reasons.asset_dependencies}
              />

              <StateCard
                title="执行规则"
                label={requirement.sequence_rules ? '[时序] 已确认' : 'Missing Sequence Rule'}
                body={requirement.sequence_rules ?? '需要明确多目标排序、动画队列和震动反馈的时序关系。'}
                tone={requirement.sequence_rules ? 'complete' : 'missing'}
                confidence={requirement.slot_confidence.sequence_rules}
                missingReason={requirement.missing_reasons.sequence_rules}
              />

              {requirement.engine_constraints ? (
                <StateCard
                  title="RAG System Insight"
                  label="Cocos 3.8.8"
                  body={requirement.engine_constraints}
                  tone="info"
                  meta={latestRag?.references.map((reference) => reference.source).join(' · ') ?? 'Ref: Cocos_Docs_v3.8.8'}
                  confidence={requirement.slot_confidence.engine_constraints}
                  missingReason={requirement.missing_reasons.engine_constraints}
                />
              ) : null}

              {requirement.next_question ? (
                <StateCard
                  title="Next Required Question"
                  label="[下一问]"
                  body={requirement.next_question}
                  tone="info"
                  meta="Claude 应优先围绕这一问题继续追问。"
                />
              ) : null}

              {latestRag ? (
                <StateCard
                  title="RAG References"
                  label={latestRag.status === 'connected' ? '[检索] 已连接' : latestRag.status === 'error' ? '[检索] 失败' : '[检索] Mock'}
                  body={latestRag.answer}
                  tone={latestRag.status === 'connected' ? 'info' : latestRag.status === 'error' ? 'missing' : 'info'}
                  meta={latestRag.references.map((reference) => `${reference.title}: ${reference.source}`).join(' · ')}
                />
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
