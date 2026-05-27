interface TopAppBarProps {
  onUploadNew: () => void
  canExport?: boolean
  onExport?: () => void
  isExporting?: boolean
}

export function TopAppBar({ onUploadNew, canExport, onExport, isExporting }: TopAppBarProps) {
  return (
    <header className="flex justify-between items-center h-16 px-lg w-full bg-surface border-b border-outline-variant z-20 shrink-0">
      <div className="flex items-center gap-md">
        <span className="material-symbols-outlined text-primary">account_tree</span>
        <h1 className="font-headline-md text-headline-md font-bold text-primary">GameUX PromptForge</h1>
        <div className="h-6 w-[1px] bg-outline-variant mx-sm" />
        <div className="flex items-center gap-sm bg-surface-container-high px-sm py-xs rounded-full border border-outline-variant">
          <span
            className="material-symbols-outlined text-tertiary"
            style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}
          >
            check_circle
          </span>
          <span className="font-label-md text-label-md text-tertiary">Document Loaded</span>
        </div>
      </div>
      <div className="flex items-center gap-md">
        {onExport && (
          <button
            onClick={onExport}
            disabled={!canExport || isExporting}
            title={!canExport ? '所有节点完成后才能导出' : undefined}
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
            {isExporting ? '生成中...' : '导出 Spec'}
          </button>
        )}
        <button
          onClick={onUploadNew}
          className="flex items-center gap-sm bg-surface-container-high hover:bg-surface-variant transition-colors text-on-surface border border-outline-variant rounded-lg px-md py-sm font-label-md text-label-md cursor-pointer active:opacity-80"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
          Upload PRD
        </button>
      </div>
    </header>
  )
}
