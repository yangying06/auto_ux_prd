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
  onConfigureEnvironment?: () => void
  onDeleteProject?: () => void
  canExport?: boolean
  onExport?: () => void
  isExporting?: boolean
  onValidatePrototype?: () => void
  canValidatePrototype?: boolean
  isValidatingPrototype?: boolean
  prototypeValidationRiskCount?: number
  onOpenQa?: () => void
  qaOpenIssueCount?: number
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
  onOpenQa,
  qaOpenIssueCount = 0,
}: TopAppBarProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectMenuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setProjectMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [projectMenuOpen])

  const runProjectAction = (action: () => void) => {
    setProjectMenuOpen(false)
    action()
  }

  return (
    <header className="relative z-[90] flex h-16 w-full shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-lg">
      <div className="flex min-w-0 items-center gap-md">
        <span className="material-symbols-outlined text-primary">account_tree</span>
        <h1 className="truncate font-headline-md text-headline-md font-bold text-primary">GameUX PromptForge</h1>
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
            onClick={() => setProjectMenuOpen((open) => !open)}
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

        {onOpenQa && (
          <button
            onClick={onOpenQa}
            className="flex items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-high px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-variant"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>bug_report</span>
            QA 工作台
            {qaOpenIssueCount > 0 ? (
              <span className="rounded bg-error px-xs py-[1px] text-[10px] leading-4 text-on-error">{qaOpenIssueCount}</span>
            ) : null}
          </button>
        )}

        {onExport && (
          <button
            onClick={onExport}
            disabled={!canExport || isExporting}
            title={!canExport ? '需要打磨的文档包确认完成后才能导出' : undefined}
            className={[
              'flex items-center gap-sm rounded-lg px-md py-sm font-label-md text-label-md border transition-colors',
              canExport && !isExporting
                ? 'bg-secondary-container text-on-secondary-container border-[#2b88ff]/30 hover:bg-secondary-container/90 cursor-pointer active:opacity-80'
                : 'bg-surface-container-high text-on-surface border-outline-variant opacity-40 cursor-not-allowed',
            ].join(' ')}
          >
            <span
              className={['material-symbols-outlined', isExporting ? 'animate-spin' : ''].join(' ').trim()}
              style={{ fontSize: '18px' }}
            >
              {isExporting ? 'sync' : 'download'}
            </span>
            {isExporting ? '生成中...' : '导出制作文档'}
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
