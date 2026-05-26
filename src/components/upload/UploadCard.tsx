import { useRef, useState } from 'react'

interface UploadCardProps {
  onFileRead: (text: string) => void
  isReading?: boolean
  error?: string | null
}

export function UploadCard({ onFileRead, isReading = false, error }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [rejectionError, setRejectionError] = useState<string | null>(null)

  const displayError = error ?? rejectionError

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.md') && file.type !== 'text/markdown') {
      setRejectionError('Please upload a Markdown (.md) file')
      return
    }
    setRejectionError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (text) onFileRead(text)
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
      <p className="text-label-md font-semibold text-on-surface-variant uppercase tracking-wider">PRD ANALYSIS ENGINE</p>

      {/* Drop zone */}
      <div
        className={`w-full min-h-[160px] rounded-lg border-2 border-dashed
          flex flex-col items-center justify-center gap-2 cursor-pointer select-none
          transition-colors duration-150
          ${isDragging ? 'border-tertiary bg-tertiary/5 glow-active' : 'border-outline bg-surface-container-lowest/40'}
          ${isReading ? 'opacity-60' : ''}
        `}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !isReading && inputRef.current?.click()}
      >
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '40px' }}>upload_file</span>
        <span className="text-headline-sm text-on-surface">
          {isDragging ? 'Release to upload' : isReading ? 'Reading file...' : 'Drop your PRD here'}
        </span>
        {!isDragging && !isReading && (
          <span className="text-body-md text-on-surface-variant">or click to browse · .md files only</span>
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

      {/* CTA button */}
      <button
        className="flex items-center gap-2 bg-surface-container-high hover:bg-surface-variant
          border border-outline-variant rounded-lg px-4 py-2
          text-label-md text-on-surface transition-colors min-h-[44px]"
        onClick={() => inputRef.current?.click()}
        disabled={isReading}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
        Upload PRD Document
      </button>

      {/* Inline error state */}
      {displayError && (
        <div className="w-full bg-error-container/10 border border-error-container rounded-lg px-4 py-2 flex items-start gap-2">
          <span className="material-symbols-outlined text-error flex-shrink-0" style={{ fontSize: '18px' }}>error_outline</span>
          <div>
            <p className="text-body-lg text-error">Upload failed</p>
            <p className="text-body-md text-on-surface-variant">{displayError}</p>
          </div>
        </div>
      )}
    </>
  )
}
