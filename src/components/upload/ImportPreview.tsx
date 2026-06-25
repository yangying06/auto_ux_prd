import type { DocumentSourceIssue, PrdImportCandidateNode, PrdImportPreview } from '../../types/prdNode'
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
            开始 AI 拆解
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

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-lg overflow-hidden">
        <section className="min-h-0 rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <div className="mb-sm flex items-center justify-between">
            <h2 className="text-label-lg font-semibold text-on-surface">原文索引</h2>
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
                      <p className="truncate text-body-lg text-on-surface">{candidate.title}</p>
                      <p className="mt-xs text-code-sm text-on-surface-variant">{candidate.sourceLabel}</p>
                    </div>
                    <span className={`shrink-0 text-code-sm ${confidenceTone(candidate)}`}>{candidate.confidence}%</span>
                  </div>
                  <div className="mt-sm h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                    <div className="h-full rounded-full bg-secondary-container" style={{ width: `${candidate.confidence}%` }} />
                  </div>
                  <p className="mt-sm text-body-md text-on-surface-variant">{candidate.reason}</p>
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
