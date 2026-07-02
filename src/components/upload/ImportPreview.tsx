import type { DocumentSourceIssue, PrdImportCandidateNode, PrdImportPreview, ProjectUiFlowEdge } from '../../types/prdNode'
import type { ProjectWorkflowState } from '../../types/projectWorkflow'

interface ImportPreviewProps {
  preview: PrdImportPreview | null
  isLoading: boolean
  error?: string | null
  projectWorkflow?: ProjectWorkflowState | null
  onConfirm: () => void
  onReset: () => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function severityClass(issue: DocumentSourceIssue) {
  if (issue.severity === 'critical') return 'border-error/50 bg-error-container/10 text-error'
  if (issue.severity === 'warning') return 'border-tertiary/50 bg-tertiary/10 text-tertiary'
  return 'border-outline-variant bg-surface-container text-on-surface-variant'
}

function confidenceTone(candidate: PrdImportCandidateNode) {
  if (candidate.confidence >= 80) return 'text-tertiary'
  if (candidate.confidence >= 64) return 'text-secondary'
  return 'text-on-surface-variant'
}

function candidateSourceBadge(candidate: PrdImportCandidateNode) {
  if (candidate.sectionId.startsWith('figma-')) return 'Figma 主界面'
  if (candidate.sectionId.startsWith('prd-supplement-')) return 'PRD 补充'
  return 'PRD 候选'
}

function candidateSourceTone(candidate: PrdImportCandidateNode) {
  if (candidate.sectionId.startsWith('figma-')) return 'border-tertiary/40 bg-tertiary/10 text-tertiary'
  if (candidate.sectionId.startsWith('prd-supplement-')) return 'border-secondary/40 bg-secondary/10 text-secondary'
  return 'border-outline-variant bg-surface-container-high text-on-surface-variant'
}

function uxMapScreenStateSummary(preview: PrdImportPreview, screenId: string) {
  const states = (preview.figmaUxMap?.states ?? []).filter((state) => state.screenId === screenId)
  if (!states.length) return '未识别独立状态'
  return states.map((state) => `${state.label} · ${state.role}`).join(' / ')
}

function uiFlowNodeLabel(preview: PrdImportPreview, nodeId: string) {
  return preview.projectUiFlow?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId
}

function uiFlowPathLabels(preview: PrdImportPreview, nodeIds: string[]) {
  return nodeIds.map((nodeId) => uiFlowNodeLabel(preview, nodeId)).filter(Boolean)
}

function cleanFlowText(value: string | null | undefined, maxLength = 120) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^(UI Flow|Figma UX Map|PRD\+Figma UI Flow)\s*[:：]\s*/iu, '')
    .replace(/^Figma\s*(箭头连接|连接线)\s*[:：-]?\s*/iu, '')
    .replace(/^PRD\s*(流程|段落)?\s*[:：-]?\s*/iu, '')
    .trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function uiFlowEdgeIntent(edge: ProjectUiFlowEdge) {
  return cleanFlowText(edge.trigger) || cleanFlowText(edge.effect) || '未命名流转'
}

function uiFlowEdgeEvidence(edge: ProjectUiFlowEdge) {
  const refs = edge.evidenceRefs
    .map((ref) => cleanFlowText(ref.quote || ref.label, 96))
    .filter(Boolean)
  return refs.slice(0, 2).join(' / ')
}

export function ImportPreview({ preview, isLoading, error, projectWorkflow, onConfirm, onReset }: ImportPreviewProps) {
  if (isLoading) {
    return (
      <div className="flex min-h-[360px] w-full flex-col items-center justify-center gap-md rounded-xl border border-outline-variant bg-surface-container-low p-xl">
        <span className="material-symbols-outlined animate-spin text-secondary" style={{ fontSize: '32px' }}>autorenew</span>
        <div className="text-center">
          <p className="text-headline-sm text-on-surface">正在建立原文索引</p>
          <p className="mt-xs text-body-md text-on-surface-variant">读取标题、片段、主题信号和导入风险</p>
        </div>
      </div>
    )
  }

  if (error || !preview) {
    return (
      <div className="flex min-h-[320px] w-full flex-col items-center justify-center gap-md rounded-xl border border-error/40 bg-error-container/10 p-xl text-center">
        <span className="material-symbols-outlined text-error" style={{ fontSize: '32px' }}>error</span>
        <div>
          <p className="text-headline-sm text-error">预览失败</p>
          <p className="mt-xs text-body-md text-on-surface-variant">{error ?? '无法读取 PRD 结构'}</p>
        </div>
        <button
          className="mt-sm flex min-h-[44px] items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-high px-md py-sm text-label-md text-on-surface hover:bg-surface-variant"
          onClick={onReset}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
          重新上传
        </button>
      </div>
    )
  }

  const { sourceIndex, candidateNodes } = preview
  const figmaUxMap = preview.figmaUxMap ?? null
  const projectUiFlow = preview.projectUiFlow ?? null
  const prdSource = preview.prdSource ?? null
  const relationSummary = preview.relationSummary ?? null
  const visibleSections = sourceIndex.sections.slice(0, 10)
  const visibleSignals = sourceIndex.keywordSignals.slice(0, 8)
  const iteration = projectWorkflow?.mode === 'existing_project_iteration' ? projectWorkflow.iteration : null
  const baselineScan = iteration?.baselineScan ?? null

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-lg">
      <header className="flex items-start justify-between gap-md">
        <div>
          <div className="flex items-center gap-sm text-on-surface">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: '24px' }}>travel_explore</span>
            <h1 className="text-headline-sm font-semibold">导入结构预览</h1>
          </div>
          <p className="mt-xs text-body-md text-on-surface-variant">
            {sourceIndex.sourceLabel} · {formatNumber(sourceIndex.totalLines)} 行 · 约 {formatNumber(sourceIndex.estimatedTokens)} tokens
          </p>
          {iteration ? (
            <div className="mt-sm flex max-w-[760px] flex-wrap gap-xs text-code-sm text-on-surface-variant">
              <span className="rounded border border-secondary/40 bg-secondary/10 px-sm py-xs text-secondary">已有项目迭代</span>
              <span className="rounded border border-outline-variant bg-surface-container px-sm py-xs">{iteration.focus || '未填写迭代焦点'}</span>
              {baselineScan ? (
                <span className="rounded border border-outline-variant bg-surface-container px-sm py-xs">
                  {baselineScan.platforms.map((item) => `${item.platform} ${item.confidence}%`).join(' / ')} · 证据 {baselineScan.evidence.length}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="mt-sm inline-flex rounded border border-outline-variant bg-surface-container px-sm py-xs text-code-sm text-on-surface-variant">
              新项目打磨
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-sm">
          <button
            className="flex min-h-[44px] items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-high px-md py-sm text-label-md text-on-surface-variant hover:bg-surface-variant"
            onClick={onReset}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
            重新上传
          </button>
          <button
            className="flex min-h-[44px] items-center gap-sm rounded-lg bg-secondary-container px-md py-sm text-label-md text-on-secondary-container hover:bg-secondary-container/90"
            onClick={onConfirm}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>account_tree</span>
            开始解析资料
          </button>
        </div>
      </header>

      <section className="grid grid-cols-5 gap-sm">
        {[
          ['标题', sourceIndex.headingCount],
          ['索引片段', sourceIndex.sectionCount],
          ['字符', sourceIndex.totalChars],
          ['最大片段', sourceIndex.largestSectionChars],
          ['候选节点', candidateNodes.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
            <p className="text-code-sm text-on-surface-variant">{label}</p>
            <p className="mt-xs text-headline-sm text-on-surface">{formatNumber(Number(value))}</p>
          </div>
        ))}
      </section>

      {prdSource ? (
        <section className="grid gap-sm rounded-lg border border-secondary/30 bg-secondary/5 p-md xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div className="min-w-0">
            <div className="flex items-center gap-xs text-secondary">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>article</span>
              <h2 className="text-label-lg font-semibold text-on-surface">PRD 补充已载入</h2>
            </div>
            <div className="mt-sm grid grid-cols-3 gap-xs">
              {[
                ['字符', prdSource.totalChars],
                ['片段', prdSource.sectionCount],
                ['对齐界面', prdSource.matchedFigmaGroups],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-secondary/25 bg-surface-container px-sm py-xs">
                  <p className="text-code-sm text-on-surface-variant">{label}</p>
                  <p className="text-label-lg text-on-surface">{formatNumber(Number(value))}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="custom-scrollbar flex max-h-40 flex-col gap-xs overflow-y-auto pr-xs">
            {prdSource.excerpts.map((section) => (
              <article key={`${section.titlePath}-${section.startLine}`} className="rounded border border-outline-variant/70 bg-surface-container px-sm py-xs">
                <div className="flex items-center justify-between gap-sm">
                  <p className="truncate text-label-md text-on-surface">{section.titlePath}</p>
                  <span className="shrink-0 text-code-sm text-secondary">第 {section.startLine}-{section.endLine} 行</span>
                </div>
                {section.excerpt ? (
                  <p className="mt-[2px] line-clamp-2 text-body-sm text-on-surface-variant">{section.excerpt}</p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : figmaUxMap ? (
        <section className="rounded-lg border border-tertiary/40 bg-tertiary/5 px-md py-sm text-body-md text-on-surface-variant">
          当前预览只收到 Figma 设计稿，未收到 PRD 正文；请确认飞书 PRD 已读取进素材池。
        </section>
      ) : null}

      {projectUiFlow ? (
        <section className="grid gap-sm rounded-lg border border-secondary/30 bg-secondary/5 p-md xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
          <div className="min-w-0">
            <div className="flex items-center gap-xs text-secondary">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>route</span>
              <h2 className="text-label-lg font-semibold text-on-surface">PRD+Figma UI Flow</h2>
            </div>
            <div className="mt-sm grid grid-cols-4 gap-xs">
              {[
                ['节点', projectUiFlow.nodes.length],
                ['流转', projectUiFlow.edges.length],
                ['分支', projectUiFlow.alternatePaths.length],
                ['待确认', projectUiFlow.ambiguities.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-secondary/25 bg-surface-container px-sm py-xs">
                  <p className="text-code-sm text-on-surface-variant">{label}</p>
                  <p className="text-label-lg text-on-surface">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-sm text-body-sm text-on-surface-variant">FlowGraph · 置信度 {projectUiFlow.confidence}%</p>
            <p className="mt-xs line-clamp-2 text-body-sm text-on-surface-variant">{projectUiFlow.summary}</p>
          </div>
          <div className="min-h-0 space-y-xs overflow-hidden">
            <div className="rounded border border-outline-variant/70 bg-surface-container px-sm py-xs">
              <p className="text-code-sm text-on-surface-variant">起点</p>
              <p className="mt-[2px] truncate text-body-md text-on-surface" title={uiFlowPathLabels(preview, projectUiFlow.entryNodeIds).join(' / ')}>
                {uiFlowPathLabels(preview, projectUiFlow.entryNodeIds).join(' / ') || '未识别'}
              </p>
            </div>
            <div className="rounded border border-outline-variant/70 bg-surface-container px-sm py-xs">
              <p className="text-code-sm text-on-surface-variant">终点</p>
              <p className="mt-[2px] truncate text-body-md text-on-surface" title={uiFlowPathLabels(preview, projectUiFlow.exitNodeIds).join(' / ')}>
                {uiFlowPathLabels(preview, projectUiFlow.exitNodeIds).join(' / ') || '未识别'}
              </p>
            </div>
            <div className="rounded border border-outline-variant/70 bg-surface-container px-sm py-xs">
              <p className="text-code-sm text-on-surface-variant">主路径</p>
              {projectUiFlow.happyPathNodeIds.length > 1 ? (
                <div className="custom-scrollbar mt-xs flex max-h-16 flex-wrap items-center gap-xs overflow-y-auto">
                  {uiFlowPathLabels(preview, projectUiFlow.happyPathNodeIds).map((label, index) => (
                    <span key={`${label}-${index}`} className="inline-flex items-center gap-xs rounded border border-secondary/30 bg-secondary/10 px-xs py-[2px] text-code-sm text-secondary">
                      {index > 0 ? <span className="text-on-surface-variant">→</span> : null}
                      <span className="max-w-[140px] truncate" title={label}>{label}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-[2px] text-body-sm text-on-surface-variant">暂未形成稳定端到端流程，请检查 Figma 连线或 PRD 流程描述。</p>
              )}
            </div>
            {projectUiFlow.edges.length ? (
              <div className="rounded border border-outline-variant/70 bg-surface-container px-sm py-xs">
                <p className="text-code-sm text-on-surface-variant">关键流转</p>
                <div className="custom-scrollbar mt-xs flex max-h-28 flex-col gap-xs overflow-y-auto pr-xs">
                  {projectUiFlow.edges.slice(0, 5).map((edge) => {
                    const evidence = uiFlowEdgeEvidence(edge)
                    return (
                      <article key={edge.id} className="rounded border border-secondary/20 bg-secondary/5 px-xs py-[3px]">
                        <p className="truncate text-body-sm text-on-surface" title={`${uiFlowNodeLabel(preview, edge.sourceNodeId)} → ${uiFlowNodeLabel(preview, edge.targetNodeId)}：${uiFlowEdgeIntent(edge)}`}>
                          {uiFlowNodeLabel(preview, edge.sourceNodeId)} → {uiFlowNodeLabel(preview, edge.targetNodeId)}：{uiFlowEdgeIntent(edge)}
                        </p>
                        {evidence ? (
                          <p className="mt-[1px] line-clamp-1 text-code-sm text-on-surface-variant" title={evidence}>证据：{evidence}</p>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {projectUiFlow.ambiguities.length ? (
              <div className="rounded border border-secondary/40 bg-surface-container px-sm py-xs text-body-sm text-on-surface-variant">
                {projectUiFlow.ambiguities.slice(0, 2).map((ambiguity) => ambiguity.message).join('；')}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {figmaUxMap ? (
        <section className="grid gap-sm rounded-lg border border-tertiary/30 bg-tertiary/5 p-md xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="min-w-0">
            <div className="flex items-center gap-xs text-tertiary">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>schema</span>
              <h2 className="text-label-lg font-semibold text-on-surface">Figma UX Map 语义审阅</h2>
            </div>
            <div className="mt-sm grid grid-cols-4 gap-xs">
              {[
                ['界面', figmaUxMap.screens.length],
                ['状态', figmaUxMap.states.length],
                ['流转', figmaUxMap.transitions.length],
                ['待确认', figmaUxMap.ambiguities.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-tertiary/25 bg-surface-container px-sm py-xs">
                  <p className="text-code-sm text-on-surface-variant">{label}</p>
                  <p className="text-label-lg text-on-surface">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-sm text-body-sm text-on-surface-variant">
              {figmaUxMap.review.source === 'ai_review' ? 'AI 已审阅' : figmaUxMap.review.source === 'ai_review_fallback' ? '使用规则兜底' : '规则识别'} · 置信度 {figmaUxMap.review.confidence}%
            </p>
            {figmaUxMap.review.notes.length ? (
              <p className="mt-xs line-clamp-2 text-body-sm text-on-surface-variant">{figmaUxMap.review.notes.join('；')}</p>
            ) : null}
            {relationSummary ? (
              <p className="mt-xs text-body-sm text-on-surface-variant">
                PRD 推断流转 {relationSummary.prdRelationCount} 条 · Figma 流转 {relationSummary.figmaTransitionCount} 条
              </p>
            ) : null}
          </div>
          <div className="min-h-0 space-y-xs overflow-hidden">
            <div className="custom-scrollbar flex max-h-40 flex-col gap-xs overflow-y-auto pr-xs">
              {figmaUxMap.screens.slice(0, 8).map((screen) => (
                <article key={screen.id} className="rounded border border-outline-variant/70 bg-surface-container px-sm py-xs">
                  <div className="flex items-center justify-between gap-sm">
                    <p className="truncate text-label-md text-on-surface">{screen.label}</p>
                    <span className="shrink-0 text-code-sm text-tertiary">{screen.confidence}%</span>
                  </div>
                  <p className="mt-[2px] line-clamp-1 text-body-sm text-on-surface-variant">
                    {uxMapScreenStateSummary(preview, screen.id)}
                  </p>
                </article>
              ))}
            </div>
            {figmaUxMap.ambiguities.length ? (
              <div className="rounded border border-tertiary/40 bg-surface-container px-sm py-xs text-body-sm text-on-surface-variant">
                {figmaUxMap.ambiguities.slice(0, 2).map((ambiguity) => ambiguity.message).join('；')}
              </div>
            ) : null}
            {relationSummary?.prdRelations.length ? (
              <div className="custom-scrollbar flex max-h-32 flex-col gap-xs overflow-y-auto pr-xs">
                {relationSummary.prdRelations.slice(0, 4).map((relation) => (
                  <article key={`${relation.sourceLabel}-${relation.targetLabel}-${relation.label}`} className="rounded border border-secondary/30 bg-surface-container px-sm py-xs">
                    <div className="flex items-center justify-between gap-sm">
                      <p className="truncate text-label-md text-on-surface">{relation.sourceLabel} → {relation.targetLabel}</p>
                      <span className="shrink-0 text-code-sm text-secondary">{relation.confidence}%</span>
                    </div>
                    <p className="mt-[2px] line-clamp-1 text-body-sm text-on-surface-variant">{relation.label} · {relation.reason}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-lg overflow-hidden">
        <section className="min-h-0 rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <div className="mb-sm flex items-center justify-between">
            <h2 className="text-label-lg font-semibold text-on-surface">{prdSource ? 'PRD 原文索引' : '导入证据索引'}</h2>
            <span className="text-code-sm text-on-surface-variant">显示前 {visibleSections.length} / {sourceIndex.sectionCount}</span>
          </div>
          <div className="flex max-h-full flex-col gap-sm overflow-y-auto pr-xs">
            {visibleSections.map((section) => (
              <article key={section.id} className="rounded-lg border border-outline-variant/70 bg-surface-container px-md py-sm">
                <div className="flex items-start gap-sm">
                  <span className="shrink-0 text-code-sm text-secondary">{section.id}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-lg text-on-surface">{section.titlePath}</p>
                    <p className="mt-xs text-code-sm text-on-surface-variant">
                      第 {section.startLine}-{section.endLine} 行 · {formatNumber(section.charCount)} 字符
                    </p>
                    {section.excerpt && (
                      <p className="mt-sm line-clamp-2 text-body-md text-on-surface-variant">{section.excerpt}</p>
                    )}
                    {section.signals.length > 0 && (
                      <div className="mt-sm flex flex-wrap gap-xs">
                        {section.signals.map((signal) => (
                          <span key={signal} className="rounded border border-outline-variant px-xs py-[2px] text-code-sm text-on-surface-variant">
                            {signal}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-md overflow-hidden">
          <section className="min-h-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-low p-md">
            <div className="mb-sm flex items-center justify-between">
              <h2 className="text-label-lg font-semibold text-on-surface">页面候选</h2>
              <span className="text-code-sm text-on-surface-variant">{candidateNodes.length} 个线索</span>
            </div>
            <div className="flex max-h-full flex-col gap-sm overflow-y-auto pr-xs">
              {candidateNodes.length > 0 ? candidateNodes.map((candidate) => (
                <article key={`${candidate.sectionId}-${candidate.title}`} className="rounded-lg border border-outline-variant/70 bg-surface-container px-md py-sm">
                  <div className="flex items-start justify-between gap-sm">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-xs">
                        <span className={`shrink-0 rounded border px-xs py-[2px] text-code-sm ${candidateSourceTone(candidate)}`}>
                          {candidateSourceBadge(candidate)}
                        </span>
                        <p className="truncate text-body-lg text-on-surface">{candidate.title}</p>
                      </div>
                      <p className="mt-xs line-clamp-2 text-code-sm text-on-surface-variant">{candidate.sourceLabel}</p>
                    </div>
                    <span className={`shrink-0 text-code-sm ${confidenceTone(candidate)}`}>{candidate.confidence}%</span>
                  </div>
                  <div className="mt-sm h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                    <div className="h-full rounded-full bg-secondary-container" style={{ width: `${candidate.confidence}%` }} />
                  </div>
                  <p className="mt-sm text-body-md text-on-surface-variant">{candidate.reason}</p>
                  {candidate.excerpt ? (
                    <p className="mt-sm line-clamp-3 rounded border border-outline-variant/70 bg-surface-container-high px-sm py-xs text-body-sm text-on-surface-variant">
                      {candidate.excerpt}
                    </p>
                  ) : null}
                </article>
              )) : (
                <div className="rounded-lg border border-outline-variant/70 bg-surface-container px-md py-lg text-body-md text-on-surface-variant">
                  未识别到明确页面候选，正式拆解会直接基于正文生成节点。
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
            <h2 className="mb-sm text-label-lg font-semibold text-on-surface">主题信号</h2>
            <div className="flex flex-wrap gap-xs">
              {visibleSignals.length > 0 ? visibleSignals.map((signal) => (
                <span key={`${signal.category}-${signal.label}`} className="rounded border border-outline-variant bg-surface-container px-sm py-xs text-code-sm text-on-surface-variant">
                  {signal.label} · {signal.matches}
                </span>
              )) : (
                <span className="text-body-md text-on-surface-variant">未命中明显主题信号</span>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
            <h2 className="mb-sm text-label-lg font-semibold text-on-surface">导入风险</h2>
            <div className="flex flex-col gap-xs">
              {sourceIndex.issues.length > 0 ? sourceIndex.issues.map((issue) => (
                <div key={issue.id} className={`rounded border px-sm py-xs ${severityClass(issue)}`}>
                  <p className="text-body-md font-semibold">{issue.title}</p>
                  <p className="mt-[2px] text-body-md text-on-surface-variant">{issue.detail}</p>
                </div>
              )) : (
                <div className="rounded border border-outline-variant bg-surface-container px-sm py-xs text-body-md text-on-surface-variant">
                  未发现明显导入风险。
                </div>
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
