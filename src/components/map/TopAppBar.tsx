import { useEffect, useRef, useState } from 'react'
import type { ExportDepth } from '../../lib/prdNodeDelivery'

interface TopAppBarProps {
  projectName: string
  archiveDirty?: boolean
  currentArchivePath?: string | null
  hasProject?: boolean
  onNewProject: () => void
  onOpenArchive: () => void
  onSaveArchive: () => void
  onSaveArchiveAs: () => void
  onConfigureEnvironment?: () => void
  onDeleteProject?: () => void
  canExport?: boolean
  onExport?: () => void
  isExporting?: boolean
  onValidatePrototype?: () => void
  canValidatePrototype?: boolean
  isValidatingPrototype?: boolean
  prototypeValidationRiskCount?: number
  onSmartArrange?: () => void
  canSmartArrange?: boolean
  onBatchGenerateFigmaDrafts?: () => void
  canBatchGenerateFigmaDrafts?: boolean
  isBatchGeneratingFigmaDrafts?: boolean
  figmaDraftReadyCount?: number
  figmaDraftTotalCount?: number
  onOpenAssets?: () => void
  onOpenQa?: () => void
  qaOpenIssueCount?: number
  exportDepth?: ExportDepth
  exportDepthOptions?: ExportDepth[]
  exportableCount?: number
  exportDoneCount?: number
  onChangeExportDepth?: (depth: ExportDepth) => void
}

function archiveLabel(archiveDirty: boolean | undefined, currentArchivePath: string | null | undefined) {
  if (archiveDirty) return '未保存'
  if (currentArchivePath) return '已保存'
  return '未存档'
}

export function TopAppBar({
  projectName,
  archiveDirty,
  currentArchivePath,
  hasProject = true,
  onNewProject,
  onOpenArchive,
  onSaveArchive,
  onSaveArchiveAs,
  onConfigureEnvironment,
  onDeleteProject,
  canExport,
  onExport,
  isExporting,
  onValidatePrototype,
  canValidatePrototype = true,
  isValidatingPrototype = false,
  prototypeValidationRiskCount = 0,
  onSmartArrange,
  canSmartArrange = true,
  onBatchGenerateFigmaDrafts,
  canBatchGenerateFigmaDrafts = false,
  isBatchGeneratingFigmaDrafts = false,
  figmaDraftReadyCount = 0,
  figmaDraftTotalCount = 0,
  onOpenAssets,
  onOpenQa,
  qaOpenIssueCount = 0,
  exportDepth = 'all',
  exportDepthOptions,
  exportableCount = 0,
  exportDoneCount = 0,
  onChangeExportDepth,
}: TopAppBarProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectMenuOpen && !workspaceMenuOpen) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target)) setProjectMenuOpen(false)
      if (!workspaceMenuRef.current?.contains(target)) setWorkspaceMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [projectMenuOpen, workspaceMenuOpen])

  const runProjectAction = (action: () => void) => {
    setProjectMenuOpen(false)
    action()
  }

  const runWorkspaceAction = (action: () => void) => {
    setWorkspaceMenuOpen(false)
    action()
  }

  const hasWorkspaceActions = Boolean(
    (onBatchGenerateFigmaDrafts && figmaDraftTotalCount > 0)
    || onOpenAssets
    || onOpenQa
  )
  const workspaceBadgeCount = figmaDraftReadyCount + qaOpenIssueCount

  return (
    <header className="relative z-[90] flex h-16 w-full shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-lg">
      <div className="flex min-w-0 items-center gap-md">
        <span className="material-symbols-outlined text-primary">account_tree</span>
        <h1 className="truncate font-headline-md text-headline-md font-bold text-primary">UX SpecForge</h1>
        <div className="mx-sm h-6 w-[1px] bg-outline-variant" />
        <div className="flex min-w-0 items-center gap-sm rounded-full border border-outline-variant bg-surface-container-high px-sm py-xs">
          <span
            className="material-symbols-outlined text-tertiary"
            style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}
          >
            check_circle
          </span>
          <span className="max-w-[260px] truncate font-label-md text-label-md text-on-surface">{projectName}</span>
          <span className="font-mono text-[10px] uppercase text-on-surface-variant">
            {archiveLabel(archiveDirty, currentArchivePath)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-md">
        <div ref={menuRef} className="relative">
          <button
            onClick={() => {
              setProjectMenuOpen((open) => !open)
              setWorkspaceMenuOpen(false)
            }}
            className="flex min-h-[40px] items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-high px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-variant"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>folder_managed</span>
            项目
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>expand_more</span>
          </button>

          {projectMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+8px)] z-[100] w-56 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low py-xs shadow-2xl">
              <button
                onClick={() => runProjectAction(onNewProject)}
                className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>note_add</span>
                新建项目
              </button>
              <button
                onClick={() => runProjectAction(onOpenArchive)}
                className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>folder_open</span>
                打开存档...
              </button>
              <button
                onClick={() => runProjectAction(onSaveArchive)}
                disabled={!hasProject}
                className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>save</span>
                保存
              </button>
              <button
                onClick={() => runProjectAction(onSaveArchiveAs)}
                disabled={!hasProject}
                className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>drive_file_rename_outline</span>
                另存为...
              </button>
              {onConfigureEnvironment ? (
                <>
                  <div className="my-xs h-px bg-outline-variant" />
                  <button
                    onClick={() => runProjectAction(onConfigureEnvironment)}
                    className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>manufacturing</span>
                    配置环境
                  </button>
                </>
              ) : null}
              {onDeleteProject ? (
                <>
                  <div className="my-xs h-px bg-outline-variant" />
                  <button
                    onClick={() => runProjectAction(onDeleteProject)}
                    disabled={!hasProject}
                    className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>delete</span>
                    删除当前项目
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {onSmartArrange && (
          <button
            data-smart-arrange="true"
            onClick={onSmartArrange}
            disabled={!canSmartArrange}
            title="智能整理节点位置，减少连线交叉"
            className={[
              'flex items-center gap-sm rounded-lg border px-md py-sm font-label-md text-label-md transition-colors',
              canSmartArrange
                ? 'border-tertiary/50 bg-tertiary-container/70 text-on-tertiary-container hover:bg-tertiary-container'
                : 'border-outline-variant bg-surface-container-high text-on-surface opacity-40 cursor-not-allowed',
            ].join(' ')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>auto_fix_high</span>
            智能整理
          </button>
        )}

        {hasWorkspaceActions ? (
          <div ref={workspaceMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setWorkspaceMenuOpen((open) => !open)
                setProjectMenuOpen(false)
              }}
              className="flex min-h-[40px] items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-high px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-variant"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>apps</span>
              工作台
              {workspaceBadgeCount > 0 ? (
                <span className="rounded bg-primary px-xs py-[1px] text-[10px] leading-4 text-on-primary">{workspaceBadgeCount}</span>
              ) : null}
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>expand_more</span>
            </button>

            {workspaceMenuOpen ? (
              <div className="absolute right-0 top-[calc(100%+8px)] z-[100] w-64 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low py-xs shadow-2xl">
                {onBatchGenerateFigmaDrafts && figmaDraftTotalCount > 0 ? (
                  <button
                    data-figma-draft-batch="true"
                    onClick={() => runWorkspaceAction(onBatchGenerateFigmaDrafts)}
                    disabled={!canBatchGenerateFigmaDrafts || isBatchGeneratingFigmaDrafts}
                    title={
                      figmaDraftReadyCount > 0
                        ? `Generate first draft prototypes for ${figmaDraftReadyCount} Figma-bound node(s)`
                        : 'All Figma-bound nodes already have draft prototypes'
                    }
                    className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span
                      className={['material-symbols-outlined text-primary', isBatchGeneratingFigmaDrafts ? 'animate-spin' : ''].join(' ').trim()}
                      style={{ fontSize: '17px' }}
                    >
                      {isBatchGeneratingFigmaDrafts ? 'sync' : 'auto_awesome_motion'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">Figma 首稿</span>
                    {figmaDraftReadyCount > 0 ? (
                      <span className="rounded bg-primary px-xs py-[1px] text-[10px] leading-4 text-on-primary">{figmaDraftReadyCount}</span>
                    ) : null}
                  </button>
                ) : null}
                {onOpenAssets ? (
                  <button
                    onClick={() => runWorkspaceAction(onOpenAssets)}
                    className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>inventory_2</span>
                    资源库
                  </button>
                ) : null}
                {onOpenQa ? (
                  <button
                    onClick={() => runWorkspaceAction(onOpenQa)}
                    className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>bug_report</span>
                    <span className="min-w-0 flex-1 truncate">QA 工作台</span>
                    {qaOpenIssueCount > 0 ? (
                      <span className="rounded bg-error px-xs py-[1px] text-[10px] leading-4 text-on-error">{qaOpenIssueCount}</span>
                    ) : null}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {onExport && (
          <div className="flex items-center gap-0 rounded-lg border border-[#2b88ff]/30 overflow-hidden">
            <button
              onClick={onExport}
              disabled={!canExport || isExporting}
              title={canExport ? `导出 ${exportableCount} 篇文档（当前：${exportDepth === 'all' ? '全部文档包' : exportDepth === 'forged' ? '含免打磨' : '仅已确认'}；已确认 ${exportDoneCount} 篇）` : '当前没有可导出的文档包，请先导入或新增节点'}
              className={[
                'flex items-center gap-sm px-md py-sm font-label-md text-label-md transition-colors',
                canExport && !isExporting
                  ? 'bg-secondary-container text-on-secondary-container hover:bg-secondary-container/90 cursor-pointer active:opacity-80'
                  : 'bg-surface-container-high text-on-surface opacity-40 cursor-not-allowed',
              ].join(' ')}
            >
              <span
                className={['material-symbols-outlined', isExporting ? 'animate-spin' : ''].join(' ').trim()}
                style={{ fontSize: '18px' }}
              >
                {isExporting ? 'sync' : 'download'}
              </span>
              {isExporting ? '生成中...' : '导出文档'}
            </button>
            {onChangeExportDepth && exportDepthOptions && exportDepthOptions.length > 1 && (
              <label className="flex items-center gap-xs border-l border-[#2b88ff]/30 bg-secondary-container/60 px-sm py-sm text-label-md text-on-secondary-container">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>tune</span>
                <select
                  value={exportDepth}
                  onChange={(event) => onChangeExportDepth(event.target.value as ExportDepth)}
                  className="bg-transparent text-on-secondary-container outline-none cursor-pointer text-label-md"
                  title="选择导出深度：是否包含尚未打磨的文档包"
                >
                  <option value="done">仅已确认 ({exportDoneCount})</option>
                  <option value="forged">含免打磨</option>
                  <option value="all">全部文档包</option>
                </select>
              </label>
            )}
          </div>
        )}

        {onValidatePrototype && (
          <button
            onClick={onValidatePrototype}
            disabled={!canValidatePrototype || isValidatingPrototype}
            title={
              canValidatePrototype && !isValidatingPrototype
                ? prototypeValidationRiskCount > 0
                  ? `还有 ${prototypeValidationRiskCount} 个文档包未确认，仍可生成 HTML 原型进行流程验证`
                  : '在应用内生成并预览 HTML 验证原型'
                : '暂无可用于生成 HTML 原型的文档包'
            }
            className={[
              'flex items-center gap-sm rounded-lg px-md py-sm font-label-md text-label-md border transition-colors',
              canValidatePrototype
                ? 'bg-tertiary-container text-on-tertiary-container border-tertiary/40 hover:bg-tertiary-container/90 cursor-pointer active:opacity-80'
                : 'bg-surface-container-high text-on-surface border-outline-variant opacity-40 cursor-not-allowed',
            ].join(' ')}
          >
            <span
              className={['material-symbols-outlined', isValidatingPrototype ? 'animate-spin' : ''].join(' ').trim()}
              style={{ fontSize: '18px' }}
            >
              {isValidatingPrototype ? 'sync' : 'preview'}
            </span>
            {isValidatingPrototype ? '生成中...' : 'HTML 验证原型'}
          </button>
        )}
      </div>
    </header>
  )
}
