import { useRef, useState } from 'react'
import type { ProjectWorkflowMode } from '../../types/projectWorkflow'

interface UploadCardProps {
  onFileRead: (text: string, filename: string) => void
  onOpenArchive?: () => void
  error?: string | null
  workflowMode: ProjectWorkflowMode
  iterationCodebasePath: string
  iterationFocus: string
  onWorkflowModeChange: (mode: ProjectWorkflowMode) => void
  onIterationCodebasePathChange: (path: string) => void
  onIterationFocusChange: (focus: string) => void
}

export function UploadCard({
  onFileRead,
  onOpenArchive,
  error,
  workflowMode,
  iterationCodebasePath,
  iterationFocus,
  onWorkflowModeChange,
  onIterationCodebasePathChange,
  onIterationFocusChange,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [rejectionError, setRejectionError] = useState<string | null>(null)

  const displayError = error ?? rejectionError

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.md') && file.type !== 'text/markdown') {
      setRejectionError('请上传Markdown (.md) 格式文件')
      return
    }
    setRejectionError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (text) onFileRead(text, file.name)
    }
    reader.readAsText(file, 'UTF-8')
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <>
      {/* App identity block */}
      <span className="material-symbols-outlined text-on-surface" style={{ fontSize: '32px' }}>account_tree</span>
      <h1 className="text-headline-sm font-semibold text-on-surface">GameUX PromptForge</h1>
      <p className="text-label-md font-semibold text-on-surface-variant uppercase tracking-wider">PRD 拆解引擎</p>

      <div className="grid w-full grid-cols-2 gap-xs rounded-lg border border-outline-variant bg-surface-container p-xs">
        {[
          { id: 'new_project' as const, label: '新项目打磨', icon: 'note_add' },
          { id: 'existing_project_iteration' as const, label: '已有项目迭代', icon: 'difference' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onWorkflowModeChange(item.id)}
            aria-pressed={workflowMode === item.id}
            className={[
              'flex min-h-[40px] items-center justify-center gap-xs rounded-md px-sm py-xs text-label-md transition-colors',
              workflowMode === item.id
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            ].join(' ')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {workflowMode === 'existing_project_iteration' ? (
        <div className="grid w-full gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <label className="grid gap-xs">
            <span className="text-label-md text-on-surface">代码库路径</span>
            <input
              value={iterationCodebasePath}
              onChange={(event) => onIterationCodebasePathChange(event.target.value)}
              className="min-h-[40px] rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface outline-none focus:border-secondary"
              placeholder="D:\\project\\client"
            />
          </label>
          <label className="grid gap-xs">
            <span className="text-label-md text-on-surface">本次迭代焦点</span>
            <textarea
              value={iterationFocus}
              onChange={(event) => onIterationFocusChange(event.target.value)}
              className="min-h-[72px] resize-none rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface outline-none focus:border-secondary"
              placeholder="例如：帮助界面的任务说明功能"
            />
          </label>
        </div>
      ) : null}

      {/* Drop zone */}
      <div
        className={`w-full min-h-[160px] rounded-lg border-2 border-dashed
          flex flex-col items-center justify-center gap-2 cursor-pointer select-none
          transition-colors duration-150
          ${isDragging ? 'border-tertiary bg-tertiary/5 glow-active' : 'border-outline bg-surface-container-lowest/40'}
        `}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '40px' }}>upload_file</span>
        <span className="text-headline-sm text-on-surface">
          {isDragging ? '松开即可上传' : '拖拽PRD文档到这里'}
        </span>
        {!isDragging && (
          <span className="text-body-md text-on-surface-variant">或点击选择文件 · 仅支持 .md 格式</span>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      {/* CTA buttons */}
      <div className="flex flex-wrap items-center justify-center gap-sm">
        <button
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 text-label-md text-on-surface transition-colors hover:bg-surface-variant"
          onClick={() => inputRef.current?.click()}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
          上传PRD文档
        </button>
        {onOpenArchive ? (
          <button
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-secondary/40 bg-secondary/10 px-4 py-2 text-label-md text-secondary transition-colors hover:bg-secondary/20"
            onClick={onOpenArchive}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>folder_open</span>
            打开存档
          </button>
        ) : null}
      </div>

      {/* Inline error state */}
      {displayError && (
        <div className="w-full bg-error-container/10 border border-error-container rounded-lg px-4 py-2 flex items-start gap-2">
          <span className="material-symbols-outlined text-error flex-shrink-0" style={{ fontSize: '18px' }}>error_outline</span>
          <div>
            <p className="text-body-lg text-error">上传失败</p>
            <p className="text-body-md text-on-surface-variant">{displayError}</p>
          </div>
        </div>
      )}
    </>
  )
}
