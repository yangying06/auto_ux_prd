import { useEffect, useRef, useState } from 'react'

interface TopAppBarProps {
  projectName: string
  archiveDirty?: boolean
  currentArchivePath?: string | null
  hasProject?: boolean
  onNewProject: () => void
  onOpenArchive: () => void
  onSaveArchive: () => void
  onSaveArchiveAs: () => void
  onOpenShortcuts?: () => void
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
  exportableCount?: number
}

function archiveLabel(archiveDirty: boolean | undefined, currentArchivePath: string | null | undefined) {
  if (archiveDirty) return '未保存'
  if (currentArchivePath) return '已保存'
  return '未存档'
}

const toolbarGroup = 'flex h-11 shrink-0 items-center gap-xs rounded-lg border border-outline-variant/70 bg-surface-container-low p-xs'
const toolbarButtonBase = 'flex h-9 shrink-0 items-center gap-xs whitespace-nowrap rounded-md border px-sm font-label-md text-label-md transition-colors'
const neutralToolbarButton = `${toolbarButtonBase} border-outline-variant bg-surface-container-high text-on-surface hover:bg-surface-variant`
const subtleToolbarButton = `${toolbarButtonBase} border-outline-variant/70 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface`

export function TopAppBar({
  projectName,
  archiveDirty,
  currentArchivePath,
  hasProject = true,
  onNewProject,
  onOpenArchive,
  onSaveArchive,
  onSaveArchiveAs,
  onOpenShortcuts,
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
  exportableCount = 0,
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
    <header className="relative z-[90] flex h-14 w-full shrink-0 items-center gap-lg border-b border-outline-variant bg-surface px-md">
      <div className="flex min-w-0 flex-1 items-center gap-sm">
        <div className="flex shrink-0 items-center gap-xs">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: '22px' }}>account_tree</span>
          <h1 className="whitespace-nowrap font-headline-md text-headline-sm font-bold text-primary">UX SpecForge</h1>
        </div>
        <div className="hidden h-5 w-px bg-outline-variant/70 md:block" />
        <div className="flex min-w-0 items-center gap-xs rounded-md border border-outline-variant/70 bg-surface-container-high px-sm py-xs">
          <span
            className="material-symbols-outlined text-tertiary"
            style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}
          >
            check_circle
          </span>
          <span className="max-w-[220px] truncate font-label-md text-label-md text-on-surface">{projectName}</span>
          <span className="shrink-0 rounded-sm bg-surface-container-low px-xs font-mono text-[10px] uppercase text-on-surface-variant">
            {archiveLabel(archiveDirty, currentArchivePath)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-sm">
        <div className={toolbarGroup}>
          <div ref={menuRef} className="relative">
            <button
              onClick={() => {
                setProjectMenuOpen((open) => !open)
                setWorkspaceMenuOpen(false)
              }}
              className={neutralToolbarButton}
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
                {onOpenShortcuts ? (
                  <button
                    onClick={() => runProjectAction(onOpenShortcuts)}
                    className="flex w-full items-center gap-sm px-md py-sm text-left text-label-md text-on-surface hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>keyboard</span>
                    快捷键
                  </button>
                ) : null}
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

          {hasWorkspaceActions ? (
            <div ref={workspaceMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceMenuOpen((open) => !open)
                  setProjectMenuOpen(false)
                }}
                className={neutralToolbarButton}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>apps</span>
                工作台
                {workspaceBadgeCount > 0 ? (
                  <span className="rounded-sm bg-primary px-xs py-[1px] text-[10px] leading-4 text-on-primary">{workspaceBadgeCount}</span>
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
                          ? `Generate first draft prototypes for ${figmaDraftReadyCount} pending Figma source(s)`
                          : 'All Figma sources already have draft prototypes'
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
                        <span className="rounded-sm bg-primary px-xs py-[1px] text-[10px] leading-4 text-on-primary">{figmaDraftReadyCount}</span>
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
                        <span className="rounded-sm bg-error px-xs py-[1px] text-[10px] leading-4 text-on-error">{qaOpenIssueCount}</span>
                      ) : null}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {onSmartArrange && (
            <button
              data-smart-arrange="true"
              onClick={onSmartArrange}
              disabled={!canSmartArrange}
              title="智能整理节点位置，减少连线交叉"
              className={[
                subtleToolbarButton,
                canSmartArrange ? 'border-tertiary/40 text-tertiary hover:bg-tertiary-container/30' : 'opacity-40 cursor-not-allowed',
              ].join(' ')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>auto_fix_high</span>
              <span className="hidden xl:inline">智能整理</span>
            </button>
          )}
        </div>

        {(onExport || onValidatePrototype) && (
          <div className={toolbarGroup}>
            {onExport && (
              <button
                onClick={onExport}
                disabled={!canExport || isExporting}
                title={canExport ? `导出完整文档包，共 ${exportableCount} 篇文档` : '当前没有可导出的文档包，请先导入或新增节点'}
                className={[
                  `${toolbarButtonBase} px-md`,
                  canExport && !isExporting
                    ? 'border-primary bg-primary text-on-primary hover:bg-primary/90 cursor-pointer active:opacity-80'
                    : 'border-outline-variant bg-surface-container-high text-on-surface opacity-40 cursor-not-allowed',
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
                  `${toolbarButtonBase} px-md`,
                  canValidatePrototype
                    ? 'border-tertiary/40 bg-surface-container-low text-tertiary hover:bg-tertiary-container/30 cursor-pointer active:opacity-80'
                    : 'border-outline-variant bg-surface-container-high text-on-surface opacity-40 cursor-not-allowed',
                ].join(' ')}
              >
                <span
                  className={['material-symbols-outlined', isValidatingPrototype ? 'animate-spin' : ''].join(' ').trim()}
                  style={{ fontSize: '18px' }}
                >
                  {isValidatingPrototype ? 'sync' : 'preview'}
                </span>
                {isValidatingPrototype ? '生成中...' : 'HTML 验证'}
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
