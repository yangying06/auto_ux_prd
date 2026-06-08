import { useEffect, useMemo, useState } from 'react'
import { sendQaChat } from '../../lib/api'
import { useAppStore } from '../../store/appStore'
import type { ChatMessage } from '../../types/chat'
import type { PrdNode, PrdTree } from '../../types/prdNode'
import type { QaIssue, QaIssueSeverity, QaIssueStatus } from '../../types/qa'

interface QaDrawerProps {
  isOpen?: boolean
  baseUrl: string
  tree: PrdTree
  activeIssueId: string | null
  onActiveIssueChange: (issueId: string | null) => void
  onClose: () => void
}

const severityLabel: Record<QaIssueSeverity, string> = {
  blocker: '阻塞',
  major: '严重',
  minor: '一般',
  trivial: '轻微',
}

const statusLabel: Partial<Record<QaIssueStatus, string>> = {
  dev_received: '已入列表',
  dev_triaging: '程序处理中',
  fix_proposed: '已有方案',
  fix_applied: '已修复',
  qa_verifying: '待回归',
  closed: '已关闭',
  reopened: '已复开',
}

function isInterfaceNode(node: PrdNode) {
  return node.type === 'page' || node.type === 'ui'
}

function formatTime(value: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function issueStatusText(issue: QaIssue) {
  if (issue.status === 'draft') return issue.readyToConfirm ? 'AI 已确认' : 'AI 确认中'
  return statusLabel[issue.status] ?? '已确认'
}

function issueStatusTone(issue: QaIssue) {
  if (issue.status === 'draft') return issue.readyToConfirm
    ? 'border-secondary/40 bg-secondary-container/25 text-on-surface'
    : 'border-primary/40 bg-primary-container/20 text-on-surface'
  if (issue.status === 'closed') return 'border-outline-variant bg-surface-container-high text-on-surface-variant'
  return 'border-secondary/40 bg-secondary-container/25 text-on-surface'
}

function contentText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={['flex', isUser ? 'justify-end' : 'justify-start'].join(' ')}>
      <div
        className={[
          'max-w-[78%] rounded-lg border px-md py-sm text-body-sm leading-relaxed shadow-sm',
          isUser
            ? 'border-primary/30 bg-primary-container/30 text-on-surface'
            : 'border-outline-variant bg-surface-container-high text-on-surface',
        ].join(' ')}
      >
        <div className="mb-1 font-label-md text-[11px] uppercase text-on-surface-variant">
          {isUser ? 'QA' : 'AI 回答'}
        </div>
        <div className="whitespace-pre-wrap">{contentText(message.content)}</div>
      </div>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[78%] rounded-lg border border-primary/30 bg-primary-container/20 px-md py-sm text-body-sm text-on-surface shadow-sm">
        <div className="mb-1 font-label-md text-[11px] uppercase text-on-surface-variant">AI 回答</div>
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined animate-spin text-primary" style={{ fontSize: '17px' }}>sync</span>
          正在确认信息是否足够报备...
        </div>
      </div>
    </div>
  )
}

export function QaDrawer({
  isOpen = true,
  baseUrl,
  tree,
  activeIssueId,
  onActiveIssueChange,
  onClose,
}: QaDrawerProps) {
  const qaIssues = useAppStore((s) => s.qaIssues)
  const createQaIssue = useAppStore((s) => s.createQaIssue)
  const deleteQaIssue = useAppStore((s) => s.deleteQaIssue)
  const appendQaIssueMessage = useAppStore((s) => s.appendQaIssueMessage)
  const applyQaIssuePatch = useAppStore((s) => s.applyQaIssuePatch)
  const addQaIssueNodeRef = useAppStore((s) => s.addQaIssueNodeRef)
  const removeQaIssueNodeRef = useAppStore((s) => s.removeQaIssueNodeRef)
  const updateQaIssueStatus = useAppStore((s) => s.updateQaIssueStatus)
  const [draftText, setDraftText] = useState('')
  const [nodeToAdd, setNodeToAdd] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const issues = useMemo(() => Object.values(qaIssues), [qaIssues])
  const confirmedIssues = useMemo(() => (
    issues
      .filter((issue) => issue.status !== 'draft')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  ), [issues])
  const draftIssues = useMemo(() => (
    issues
      .filter((issue) => issue.status === 'draft')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  ), [issues])
  const activeIssue = activeIssueId ? qaIssues[activeIssueId] ?? null : null
  const interfaceNodes = useMemo(() => (
    Object.values(tree)
      .filter(isInterfaceNode)
      .sort((a, b) => a.level - b.level || a.order - b.order || a.label.localeCompare(b.label))
  ), [tree])
  const selectableNodes = useMemo(() => (
    interfaceNodes.filter((node) => !activeIssue?.nodeRefs.some((ref) => ref.nodeId === node.id))
  ), [activeIssue?.nodeRefs, interfaceNodes])

  useEffect(() => {
    if (!isOpen) return
    if (activeIssueId && qaIssues[activeIssueId]) return
    const reusableDraft = draftIssues[0]
    if (reusableDraft) {
      onActiveIssueChange(reusableDraft.id)
      return
    }
    const id = createQaIssue(null)
    onActiveIssueChange(id)
  }, [activeIssueId, createQaIssue, draftIssues, isOpen, onActiveIssueChange, qaIssues])

  useEffect(() => {
    setNodeToAdd(selectableNodes[0]?.id ?? '')
  }, [selectableNodes])

  if (!isOpen) return null

  function handleNewDraft() {
    const id = createQaIssue(null)
    onActiveIssueChange(id)
    setDraftText('')
    setError(null)
  }

  function handleDeleteIssue(issue: QaIssue) {
    if (!window.confirm(`确定删除「${issue.title}」吗？`)) return
    deleteQaIssue(issue.id)
    if (activeIssueId === issue.id) {
      onActiveIssueChange(draftIssues.find((item) => item.id !== issue.id)?.id ?? confirmedIssues.find((item) => item.id !== issue.id)?.id ?? null)
    }
  }

  async function handleSend() {
    if (!activeIssue || activeIssue.status !== 'draft' || isSending) return
    const text = draftText.trim()
    if (!text) return

    const userMessage: ChatMessage = { role: 'user', content: text }
    const nextMessages = [...activeIssue.messages, userMessage]
    const nextIssue = { ...activeIssue, messages: nextMessages }
    appendQaIssueMessage(activeIssue.id, userMessage)
    setDraftText('')
    setError(null)
    setIsSending(true)

    try {
      const response = await sendQaChat(baseUrl, nextIssue, nextMessages, tree)
      appendQaIssueMessage(activeIssue.id, { role: 'assistant', content: response.reply })
      applyQaIssuePatch(activeIssue.id, { ...response.issuePatch, readyToConfirm: response.readyToConfirm })
      if (response.readyToConfirm) {
        updateQaIssueStatus(activeIssue.id, 'dev_received')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'QA AI 确认失败'
      setError(message)
      appendQaIssueMessage(activeIssue.id, { role: 'assistant', content: `QA 确认请求失败：${message}` })
    } finally {
      setIsSending(false)
    }
  }

  const needsNode = activeIssue?.status === 'draft' && activeIssue.nodeRefs.length === 0

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background animate-fade-in">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-lg">
        <div className="flex min-w-0 items-center gap-md">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high text-on-surface-variant hover:text-on-surface"
            aria-label="返回导图"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_back</span>
          </button>
          <span className="material-symbols-outlined text-primary">bug_report</span>
          <div className="min-w-0">
            <h1 className="truncate font-headline-md text-headline-md font-bold text-primary">QA 报备工作台</h1>
            <p className="text-body-sm text-on-surface-variant">AI 没确认前持续追问；确认后自动进入左侧 bug 列表。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleNewDraft}
          className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-opacity hover:opacity-90"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
          新报备
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_340px] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-outline-variant bg-surface-container-low">
          <div className="shrink-0 border-b border-outline-variant p-md">
            <div className="font-title-sm text-title-sm text-on-surface">已确认 bug</div>
            <div className="mt-xs text-body-sm text-on-surface-variant">只有 AI 确认后的报备会出现在这里。</div>
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 space-y-sm overflow-y-auto p-md">
            {confirmedIssues.length === 0 ? (
              <div className="rounded-lg border border-dashed border-outline-variant bg-surface p-md text-body-sm text-on-surface-variant">
                暂无已确认 bug。
              </div>
            ) : confirmedIssues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => onActiveIssueChange(issue.id)}
                className={[
                  'w-full rounded-lg border p-sm text-left transition-colors',
                  issue.id === activeIssueId
                    ? 'border-primary bg-primary-container/25'
                    : 'border-outline-variant bg-surface hover:border-primary/50',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-sm">
                  <span className="min-w-0 line-clamp-2 font-label-md text-label-md text-on-surface">{issue.title}</span>
                  <span className="shrink-0 rounded border border-outline-variant px-xs py-[2px] text-[10px] text-on-surface-variant">
                    {severityLabel[issue.severity]}
                  </span>
                </div>
                <div className="mt-xs text-[11px] text-on-surface-variant">
                  {issueStatusText(issue)} · {formatTime(issue.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-background">
          {!activeIssue ? (
            <div className="flex flex-1 items-center justify-center p-lg">
              <button
                type="button"
                onClick={handleNewDraft}
                className="rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-lg text-body-sm text-on-surface-variant hover:border-primary hover:text-on-surface"
              >
                新建一个 QA 报备
              </button>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-outline-variant bg-surface-container-low px-lg py-md">
                <div className="flex items-start justify-between gap-md">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-sm">
                      <span className={['rounded border px-xs py-[2px] text-[11px]', issueStatusTone(activeIssue)].join(' ')}>
                        {issueStatusText(activeIssue)}
                      </span>
                      {activeIssue.status !== 'draft' ? (
                        <span className="text-body-sm text-on-surface-variant">已添加到左侧列表</span>
                      ) : null}
                    </div>
                    <h2 className="mt-sm truncate font-title-md text-title-md text-on-surface">{activeIssue.title}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteIssue(activeIssue)}
                    className="rounded border border-error/40 px-sm py-xs text-label-md text-error hover:bg-error/10"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="custom-scrollbar min-h-0 flex-1 space-y-md overflow-y-auto p-lg">
                {activeIssue.messages.map((message, index) => (
                  <MessageBubble key={index} message={message} />
                ))}
                {isSending ? <ThinkingBubble /> : null}
              </div>

              {error ? (
                <div className="mx-lg mb-sm rounded border border-error/40 bg-error/10 p-sm text-body-sm text-error">{error}</div>
              ) : null}

              <div className="shrink-0 border-t border-outline-variant bg-surface-container-low p-lg">
                {activeIssue.status === 'draft' ? (
                  <>
                    <textarea
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                      placeholder={needsNode ? '先在右侧添加界面节点，再描述问题' : '描述问题现象、复现步骤、期望结果或当前异常'}
                      className="h-28 w-full resize-none rounded-lg border border-outline-variant bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => { void handleSend() }}
                      disabled={!draftText.trim() || isSending || needsNode}
                      className="mt-sm flex w-full items-center justify-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md text-on-primary disabled:opacity-50"
                    >
                      <span className={['material-symbols-outlined', isSending ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '18px' }}>
                        {isSending ? 'sync' : 'send'}
                      </span>
                      {isSending ? '等待 AI 回答...' : '发送给 AI'}
                    </button>
                  </>
                ) : (
                  <div className="rounded-lg border border-secondary/40 bg-secondary-container/20 p-md text-center text-body-sm text-on-surface">
                    这个 bug 已由 AI 确认并加入左侧列表。
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="flex min-h-0 flex-col border-l border-outline-variant bg-surface-container-low">
          <div className="shrink-0 border-b border-outline-variant p-md">
            <div className="font-title-sm text-title-sm text-on-surface">报备设置</div>
            <div className="mt-xs text-body-sm text-on-surface-variant">只保留必要信息。</div>
          </div>

          {activeIssue ? (
            <div className="custom-scrollbar min-h-0 flex-1 space-y-md overflow-y-auto p-md">
              <label className="block">
                <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">严重等级</span>
                <select
                  value={activeIssue.severity}
                  onChange={(event) => applyQaIssuePatch(activeIssue.id, { severity: event.target.value as QaIssueSeverity })}
                  className="w-full rounded-lg border border-outline-variant bg-surface p-sm text-body-sm text-on-surface outline-none focus:border-primary"
                >
                  {Object.entries(severityLabel).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-xs font-label-md text-label-md text-on-surface-variant">引用界面节点</div>
                <p className="mb-sm text-body-sm text-on-surface-variant">
                  从节点详情进入会自动引用；从顶部进入请手动添加。
                </p>
                {activeIssue.status === 'draft' ? (
                  <div className="mb-sm flex gap-xs">
                    <select
                      value={nodeToAdd}
                      onChange={(event) => setNodeToAdd(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface p-sm text-body-sm text-on-surface outline-none focus:border-primary"
                    >
                      {selectableNodes.length === 0 ? (
                        <option value="">没有可添加的界面节点</option>
                      ) : selectableNodes.map((node) => (
                        <option key={node.id} value={node.id}>{node.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!nodeToAdd}
                      onClick={() => nodeToAdd && addQaIssueNodeRef(activeIssue.id, nodeToAdd)}
                      className="rounded-lg bg-secondary-container px-sm py-sm text-label-md text-on-secondary-container disabled:opacity-40"
                    >
                      添加
                    </button>
                  </div>
                ) : null}

                <div className="space-y-xs">
                  {activeIssue.nodeRefs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-outline-variant bg-surface p-sm text-body-sm text-on-surface-variant">
                      请先添加一个界面节点。
                    </div>
                  ) : activeIssue.nodeRefs.map((ref) => (
                    <div key={ref.nodeId} className="flex items-start justify-between gap-sm rounded-lg border border-outline-variant bg-surface p-sm">
                      <div className="min-w-0">
                        <div className="truncate font-label-md text-label-md text-on-surface">{ref.title}</div>
                        <div className="mt-1 line-clamp-3 text-body-sm text-on-surface-variant">{ref.summary}</div>
                      </div>
                      {activeIssue.status === 'draft' ? (
                        <button
                          type="button"
                          onClick={() => removeQaIssueNodeRef(activeIssue.id, ref.nodeId)}
                          className="shrink-0 rounded p-xs text-on-surface-variant hover:bg-surface-variant hover:text-error"
                          aria-label="移除引用"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>close</span>
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      </main>
    </div>
  )
}
