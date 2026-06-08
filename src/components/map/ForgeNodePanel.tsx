import { useEffect, useState } from 'react'
import { createNoSpecialPerformanceSpec, resolveNodePerformanceSpec } from '../../lib/performanceOrchestration'
import { formatSpecLens, resolveNodeAudience, resolveNodeSpecLens } from '../../lib/prdNodeLens'
import { useAppStore } from '../../store/appStore'
import type { PrdNode } from '../../types/prdNode'
import { DocumentComparePreview, DocumentDiffPreview, DocumentPreview } from './DocumentPreview'

interface ForgeNodePanelProps {
  node: PrdNode
}

type DocumentReviewMode = 'final' | 'diff' | 'compare'

function statusLabel(node: PrdNode) {
  if (node.status === 'done') return '已确认'
  return node.needsPolish ? '待补齐' : '可直接导出'
}

function audienceLabel(audience: ReturnType<typeof resolveNodeAudience>) {
  if (audience === 'client') return '客户端'
  if (audience === 'server') return '服务端'
  if (audience === 'config') return '配置'
  if (audience === 'api') return '接口'
  if (audience === 'acceptance') return '验收'
  if (audience === 'appendix') return '附录'
  if (audience === 'overview') return '概览'
  if (audience === 'mixed') return '跨职责'
  return '文档包'
}

function PerformanceOrchestrationPanel({ node }: { node: PrdNode }) {
  const updateNode = useAppStore((state) => state.updateNode)
  const spec = resolveNodePerformanceSpec(node)
  const detected = Boolean(spec?.detected && !spec.disabled)

  return (
    <section className="mb-md border-b border-outline-variant pb-md">
      <div className="mb-sm flex items-start justify-between gap-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-xs text-label-lg font-semibold text-on-surface">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '18px' }}>auto_awesome_motion</span>
            表现编排
          </div>
          <p className="mt-xs text-body-sm leading-relaxed text-on-surface-variant">
            默认扫描节点里的特效、弹窗、数值、命中、阶段演出等缺口，按程序员实现前会卡住的问题追问设计师。
          </p>
        </div>
        <span className={[
          'shrink-0 rounded px-sm py-xs text-label-md font-medium',
          spec?.disabled
            ? 'bg-surface-container-high text-on-surface-variant'
            : detected
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-surface-container-high text-on-surface-variant',
        ].join(' ')}>
          {spec?.disabled ? '无特殊表现' : detected ? '已识别' : '未识别'}
        </span>
      </div>

      {spec?.disabled ? (
        <div className="space-y-sm">
          <p className="text-body-sm text-on-surface-variant">
            该节点已标记为基础 UI/状态说明，不再额外追问表现编排。
          </p>
          <button
            type="button"
            onClick={() => updateNode(node.id, { performanceSpec: null })}
            className="rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            恢复自动扫描
          </button>
        </div>
      ) : detected && spec ? (
        <div className="space-y-sm">
          <div className="flex flex-wrap gap-xs">
            {spec.eventTypes.map((type) => (
              <span key={type} className="rounded border border-primary/30 bg-primary-container/40 px-sm py-xs text-label-md text-on-primary-container">
                {type}
              </span>
            ))}
            <span className="rounded border border-outline-variant bg-surface-container-high px-sm py-xs text-label-md text-on-surface-variant">
              置信度 {spec.confidence}%
            </span>
          </div>

          {spec.sequence.length ? (
            <div className="space-y-xs">
              <div className="text-label-md font-medium text-on-surface">流程草案</div>
              <ol className="list-decimal space-y-xs pl-md text-body-sm leading-relaxed text-on-surface-variant">
                {spec.sequence.slice(0, 4).map((step, index) => (
                  <li key={`${step.title}-${index}`}>
                    <span className="text-on-surface">{step.title}</span>：{step.detail}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {spec.openQuestions.length ? (
            <div className="space-y-xs">
              <div className="text-label-md font-medium text-on-surface">待确认问题</div>
              <ul className="list-disc space-y-xs pl-md text-body-sm leading-relaxed text-on-surface-variant">
                {spec.openQuestions.slice(0, 4).map((question) => <li key={question}>{question}</li>)}
              </ul>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => updateNode(node.id, { performanceSpec: createNoSpecialPerformanceSpec() })}
            className="rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            标记为无特殊表现
          </button>
        </div>
      ) : (
        <p className="text-body-sm leading-relaxed text-on-surface-variant">
          当前节点没有明显表现编排信号。后续对话中如果补充“播放特效、弹窗、金币、连线、完成反馈”等内容，系统会自动进入表现澄清。
        </p>
      )}
    </section>
  )
}

export function ForgeNodePanel({ node }: ForgeNodePanelProps) {
  const revision = useAppStore((state) => state.nodePolishRevisions[node.id])
  const acceptRevision = useAppStore((state) => state.acceptNodePolishRevision)
  const revertRevision = useAppStore((state) => state.revertNodePolishRevision)
  const hasPendingRevision = Boolean(revision && !revision.accepted)
  const [mode, setMode] = useState<DocumentReviewMode>(hasPendingRevision ? 'diff' : 'final')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (hasPendingRevision) setMode('diff')
    else setMode('final')
  }, [hasPendingRevision, revision?.id])

  async function copyRevisionSummary() {
    if (!revision) return
    const labels = revision.changedFields.map((field) => {
      if (field === 'summary') return '摘要'
      if (field === 'content') return '正文'
      return '实现备注'
    })
    const text = [
      `节点：${node.label}`,
      `时间：${new Date(revision.createdAt).toLocaleString()}`,
      `变更字段：${labels.join('、') || '无'}`,
      '',
      '打磨前摘要：',
      revision.before.summary || '无',
      '',
      '打磨后摘要：',
      revision.after.summary || '无',
    ].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 1600)
    }
  }

  return (
    <aside className="flex h-full w-[460px] shrink-0 flex-col overflow-hidden border-r border-outline-variant bg-surface-container">
      <div className="shrink-0 border-b border-outline-variant bg-surface px-lg py-md">
        <div className="flex flex-wrap items-center gap-sm">
          <span className="rounded bg-primary-container px-sm py-xs text-label-md font-medium text-on-primary-container">
            {audienceLabel(resolveNodeAudience(node))}
          </span>
          <span className="rounded bg-surface-container-high px-sm py-xs text-label-md font-medium text-on-surface-variant">
            {formatSpecLens(resolveNodeSpecLens(node))}
          </span>
          <span className="rounded bg-surface-container-high px-sm py-xs font-code-sm text-code-sm text-on-surface-variant">
            {node.docPath ?? node.id}
          </span>
          <span className={[
            'rounded px-sm py-xs text-label-md font-medium',
            node.status === 'done'
              ? 'bg-tertiary-container text-on-tertiary-container'
              : node.needsPolish
                ? 'bg-secondary-container text-on-secondary-container'
                : 'bg-surface-variant text-on-surface-variant',
          ].join(' ')}>
            {statusLabel(node)}
          </span>
        </div>

        <div className="mt-md flex flex-wrap items-center justify-between gap-sm">
          <div className="inline-flex overflow-hidden rounded border border-outline-variant bg-surface-container">
            {[
              { id: 'final', label: '最终文档' },
              { id: 'diff', label: '本轮变更', disabled: !revision },
              { id: 'compare', label: '原文对照', disabled: !revision },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => setMode(item.id as DocumentReviewMode)}
                className={[
                  'px-sm py-xs text-label-md font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
                  mode === item.id
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                ].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </div>

          {revision ? (
            <div className="flex items-center gap-xs">
              <button
                type="button"
                onClick={() => { void copyRevisionSummary() }}
                className="rounded border border-outline-variant px-sm py-xs text-label-md font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              >
                {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制摘要'}
              </button>
              <button
                type="button"
                onClick={() => acceptRevision(node.id)}
                className="rounded border border-tertiary/60 px-sm py-xs text-label-md font-medium text-tertiary hover:bg-tertiary-container"
              >
                接受本轮
              </button>
              <button
                type="button"
                onClick={() => revertRevision(node.id)}
                className="rounded border border-error/60 px-sm py-xs text-label-md font-medium text-error hover:bg-error-container/40"
              >
                回退
              </button>
            </div>
          ) : null}
        </div>

        {hasPendingRevision ? (
          <div className="mt-sm rounded border border-tertiary/40 bg-tertiary-container/30 px-sm py-xs text-body-sm text-on-surface-variant">
            新一轮打磨已写入文档，请审阅变更后接受或回退。
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-lg py-md">
        {mode === 'final' ? <PerformanceOrchestrationPanel node={node} /> : null}
        {mode === 'diff' && revision ? (
          <DocumentDiffPreview node={node} revision={revision} />
        ) : mode === 'compare' && revision ? (
          <DocumentComparePreview node={node} revision={revision} />
        ) : (
          <DocumentPreview node={node} variant="full" />
        )}
      </div>
    </aside>
  )
}
