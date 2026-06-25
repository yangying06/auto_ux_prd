import { useMemo, useState } from 'react'
import { formatReusableLogicAssetForPrompt, reusableLogicTypeLabel } from '../../lib/reusableLogicSedimentation'
import type { ReusableLogicAsset, ReusableLogicAssetType } from '../../types/reusableLogic'

interface ReusableLogicSedimentationDialogProps {
  isOpen: boolean
  assets: ReusableLogicAsset[]
  onClose: () => void
  onApprove: (assetId: string, patch?: Partial<ReusableLogicAsset>) => void
  onIgnore: (assetId: string) => void
  onApproveAndUse: (assetId: string, patch?: Partial<ReusableLogicAsset>) => void
  onContinue?: () => void
}

interface DraftState {
  name: string
  type: ReusableLogicAssetType
  description: string
  logic: string
  usageGuidance: string
  tags: string
}

function draftFromAsset(asset: ReusableLogicAsset): DraftState {
  return {
    name: asset.name,
    type: asset.type,
    description: asset.description,
    logic: asset.logic,
    usageGuidance: asset.usageGuidance,
    tags: asset.tags.join('、'),
  }
}

function patchFromDraft(draft: DraftState): Partial<ReusableLogicAsset> {
  return {
    name: draft.name.trim(),
    type: draft.type,
    description: draft.description.trim(),
    logic: draft.logic.trim(),
    usageGuidance: draft.usageGuidance.trim(),
    tags: draft.tags.split(/[、,\n]/u).map((item) => item.trim()).filter(Boolean).slice(0, 10),
  }
}

const TYPE_OPTIONS: ReusableLogicAssetType[] = [
  'interaction_state',
  'animation_rule',
  'feedback_pattern',
  'component_pattern',
  'copywriting_pattern',
]

export function ReusableLogicSedimentationDialog({
  isOpen,
  assets,
  onClose,
  onApprove,
  onIgnore,
  onApproveAndUse,
  onContinue,
}: ReusableLogicSedimentationDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null
  const [draftById, setDraftById] = useState<Record<string, DraftState>>({})
  const draft = selectedAsset ? draftById[selectedAsset.id] ?? draftFromAsset(selectedAsset) : null
  const pendingCount = assets.filter((asset) => asset.status === 'candidate').length
  const approvedCount = assets.filter((asset) => asset.status === 'approved').length
  const previewPrompt = useMemo(() => {
    if (!selectedAsset || !draft) return ''
    return formatReusableLogicAssetForPrompt({ ...selectedAsset, ...patchFromDraft(draft) })
  }, [draft, selectedAsset])

  if (!isOpen || !selectedAsset || !draft) return null

  const updateDraft = (patch: Partial<DraftState>) => {
    setDraftById((current) => ({
      ...current,
      [selectedAsset.id]: { ...draft, ...patch },
    }))
  }

  const approveSelected = () => onApprove(selectedAsset.id, patchFromDraft(draft))
  const useSelected = () => onApproveAndUse(selectedAsset.id, patchFromDraft(draft))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 px-lg py-lg">
      <div className="flex max-h-[86vh] w-full max-w-[1040px] overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-xl">
        <aside className="w-[280px] shrink-0 border-r border-outline-variant bg-surface-container-low p-md">
          <div className="mb-md flex items-start justify-between gap-sm">
            <div>
              <h2 className="font-title-md text-title-md text-on-surface">沉淀表现逻辑</h2>
              <p className="mt-xs text-body-sm text-on-surface-variant">
                草稿模式中有 {pendingCount} 条候选可复用逻辑。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              aria-label="关闭"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
            </button>
          </div>
          <div className="space-y-xs overflow-y-auto pr-xs">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSelectedId(asset.id)}
                className={[
                  'w-full rounded-md border p-sm text-left transition-colors',
                  selectedAsset.id === asset.id
                    ? 'border-secondary bg-secondary-container text-on-secondary-container'
                    : 'border-outline-variant bg-surface text-on-surface hover:bg-surface-container',
                ].join(' ')}
              >
                <span className="block truncate text-label-md font-medium">{asset.name}</span>
                <span className="mt-xs block text-body-sm text-on-surface-variant">
                  {reusableLogicTypeLabel(asset.type)} / {asset.status === 'approved' ? '已入库' : asset.status === 'ignored' ? '已忽略' : '待确认'}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-md border-b border-outline-variant px-lg py-md">
            <div className="min-w-0">
              <div className="text-label-md text-on-surface-variant">来自 {selectedAsset.source.nodeLabel}</div>
              <h3 className="truncate font-title-md text-title-md text-on-surface">{selectedAsset.name}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-xs text-label-md text-on-surface-variant">
              <span className="rounded bg-tertiary-container px-sm py-xs text-on-tertiary-container">已入库 {approvedCount}</span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-lg overflow-y-auto p-lg">
            <div className="space-y-md">
              <label className="block">
                <span className="mb-xs block text-label-md text-on-surface-variant">名称</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  className="h-10 w-full rounded-md border border-outline-variant bg-surface px-sm text-body-md text-on-surface outline-none focus:border-secondary"
                />
              </label>
              <label className="block">
                <span className="mb-xs block text-label-md text-on-surface-variant">类型</span>
                <select
                  value={draft.type}
                  onChange={(event) => updateDraft({ type: event.target.value as ReusableLogicAssetType })}
                  className="h-10 w-full rounded-md border border-outline-variant bg-surface px-sm text-body-md text-on-surface outline-none focus:border-secondary"
                >
                  {TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>{reusableLogicTypeLabel(type)}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-xs block text-label-md text-on-surface-variant">说明</span>
                <input
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                  className="h-10 w-full rounded-md border border-outline-variant bg-surface px-sm text-body-md text-on-surface outline-none focus:border-secondary"
                />
              </label>
              <label className="block">
                <span className="mb-xs block text-label-md text-on-surface-variant">表现逻辑</span>
                <textarea
                  value={draft.logic}
                  onChange={(event) => updateDraft({ logic: event.target.value })}
                  rows={8}
                  className="w-full resize-none rounded-md border border-outline-variant bg-surface p-sm text-body-md text-on-surface outline-none focus:border-secondary"
                />
              </label>
              <label className="block">
                <span className="mb-xs block text-label-md text-on-surface-variant">复用注意</span>
                <textarea
                  value={draft.usageGuidance}
                  onChange={(event) => updateDraft({ usageGuidance: event.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-md border border-outline-variant bg-surface p-sm text-body-md text-on-surface outline-none focus:border-secondary"
                />
              </label>
              <label className="block">
                <span className="mb-xs block text-label-md text-on-surface-variant">标签</span>
                <input
                  value={draft.tags}
                  onChange={(event) => updateDraft({ tags: event.target.value })}
                  className="h-10 w-full rounded-md border border-outline-variant bg-surface px-sm text-body-md text-on-surface outline-none focus:border-secondary"
                />
              </label>
            </div>

            <div className="min-w-0 rounded-md border border-outline-variant bg-surface-container-low p-md">
              <div className="mb-sm flex items-center gap-xs text-label-md text-on-surface">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>data_object</span>
                生成提示预览
              </div>
              <pre className="max-h-[520px] whitespace-pre-wrap break-words text-code-sm text-on-surface-variant">{previewPrompt}</pre>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-md border-t border-outline-variant px-lg py-md">
            <button
              type="button"
              onClick={() => onIgnore(selectedAsset.id)}
              className="flex min-h-[38px] items-center gap-xs rounded-md border border-outline-variant px-md text-label-md text-on-surface-variant hover:bg-surface-container"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>block</span>
              忽略
            </button>
            <div className="flex items-center gap-sm">
              {onContinue ? (
                <button
                  type="button"
                  onClick={onContinue}
                  className="min-h-[38px] rounded-md border border-outline-variant px-md text-label-md text-on-surface-variant hover:bg-surface-container"
                >
                  继续原操作
                </button>
              ) : null}
              <button
                type="button"
                onClick={approveSelected}
                className="min-h-[38px] rounded-md border border-secondary bg-secondary-container px-md text-label-md font-medium text-on-secondary-container hover:opacity-90"
              >
                确认并补充上下文
              </button>
              <button
                type="button"
                onClick={useSelected}
                className="flex min-h-[38px] items-center gap-xs rounded-md border border-tertiary bg-tertiary-container px-md text-label-md font-medium text-on-tertiary-container hover:opacity-90"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>play_arrow</span>
                补充上下文并生成预览
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  )
}
