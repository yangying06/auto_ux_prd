import type { ReactNode } from 'react'
import type { PrdNode } from '../../types/prdNode'

type DocumentPreviewVariant = 'drawer' | 'full'
type MarkdownDensity = 'full' | 'compact'

interface DocumentPreviewProps {
  node: PrdNode
  variant?: DocumentPreviewVariant
}

function textOrNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeBody(content: string) {
  return content
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasMarkdownHeading(content: string) {
  return /^#{1,4}\s+\S/m.test(content)
}

export function extractNodeSnippet(node: PrdNode, maxLength = 170) {
  const source = textOrNull(node.content) ?? textOrNull(node.summary) ?? node.label
  const normalized = source
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+[\.)]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).replace(/[，。；、\s]+$/u, '')}...`
}

export function buildDocumentMarkdown(node: PrdNode) {
  const lines: string[] = [`# ${node.label}`]

  if (node.docPath || node.extractedFrom) {
    lines.push('', `> ${[node.docPath ? `导出：${node.docPath}` : null, node.extractedFrom ? `原文：${node.extractedFrom}` : null].filter(Boolean).join(' · ')}`)
  }

  if (textOrNull(node.summary)) {
    lines.push('', '## 提炼内容', '', node.summary.trim())
  }

  const body = normalizeBody(node.content)
  if (body && body !== node.summary?.trim()) {
    lines.push('', hasMarkdownHeading(body) ? body : `## 拆分整理\n\n${body}`)
  }

  if (node.references?.length) {
    lines.push('', '## 跨页面引用', '')
    for (const reference of node.references) {
      lines.push(`- ${reference.label}${reference.targetNodeId ? ` → ${reference.targetNodeId}` : ''}${reference.reason ? `：${reference.reason}` : ''}`)
    }
  }

  if (textOrNull(node.handoffGoal)) {
    lines.push('', '## AI 接力用途', '', node.handoffGoal!.trim())
  }

  if (textOrNull(node.qualityGate)) {
    lines.push('', '## 交付检查', '', node.qualityGate!.trim())
  }

  if (textOrNull(node.techNotes)) {
    lines.push('', '## 实现备注', '', node.techNotes!.trim())
  }

  return lines.join('\n')
}

function buildNodeBodyMarkdown(node: PrdNode) {
  const lines: string[] = []

  if (textOrNull(node.summary)) {
    lines.push('## 提炼内容', '', node.summary.trim())
  }

  const body = normalizeBody(node.content)
  if (body && body !== node.summary?.trim()) {
    lines.push('', hasMarkdownHeading(body) ? body : body)
  }

  if (node.references?.length) {
    lines.push('', '## 跨页面引用', '')
    for (const reference of node.references) {
      lines.push(`- ${reference.label}${reference.targetNodeId ? ` → ${reference.targetNodeId}` : ''}${reference.reason ? `：${reference.reason}` : ''}`)
    }
  }

  if (textOrNull(node.handoffGoal)) {
    lines.push('', '## AI 接力用途', '', node.handoffGoal!.trim())
  }

  if (textOrNull(node.qualityGate)) {
    lines.push('', '## 交付检查', '', node.qualityGate!.trim())
  }

  if (textOrNull(node.techNotes)) {
    lines.push('', '## 实现备注', '', node.techNotes!.trim())
  }

  return lines.join('\n').trim()
}

function limitMarkdownLines(markdown: string, maxNonEmptyLines: number) {
  const output: string[] = []
  let nonEmptyLines = 0

  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim()) nonEmptyLines += 1
    if (nonEmptyLines > maxNonEmptyLines) break
    output.push(line)
  }

  return output.join('\n').trim()
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-surface-container-high px-1 py-[1px] font-code-sm text-code-sm text-on-primary-container">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={index}>{part}</span>
  })
}

function isTableLine(line: string) {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.includes('|', 1)
}

function isTableSeparator(line: string) {
  return /^[\s|:-]+$/.test(line.trim()) && line.includes('-')
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function renderTable(lines: string[], key: number, density: MarkdownDensity) {
  const rows = lines.filter((line) => !isTableSeparator(line)).map(tableCells)
  if (!rows.length) return null
  const [head, ...body] = rows

  return (
    <div key={key} className="overflow-hidden rounded border border-outline-variant">
      <table className={`w-full border-collapse text-left ${density === 'compact' ? 'text-code-sm' : 'text-body-sm'}`}>
        <thead className="bg-surface-container-high text-on-surface">
          <tr>
            {head.map((cell, index) => (
              <th key={index} className="border-b border-outline-variant px-sm py-xs font-medium">
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-outline-variant/60">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-sm py-xs text-on-surface-variant">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function flushParagraph(paragraph: string[], blocks: ReactNode[], key: number, density: MarkdownDensity) {
  if (!paragraph.length) return
  blocks.push(
    <p
      key={key}
      className={density === 'compact'
        ? 'line-clamp-2 text-body-sm leading-relaxed text-on-surface-variant'
        : 'whitespace-pre-line text-body-md leading-relaxed text-on-surface-variant'}
    >
      {renderInline(paragraph.join('\n'))}
    </p>
  )
  paragraph.length = 0
}

function renderMarkdown(markdown: string, density: MarkdownDensity = 'full') {
  const lines = markdown.split(/\r?\n/)
  const blocks: ReactNode[] = []
  const paragraph: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const key = blocks.length + index

    if (!trimmed) {
      flushParagraph(paragraph, blocks, key, density)
      continue
    }

    if (isTableLine(line)) {
      flushParagraph(paragraph, blocks, key, density)
      const tableLines = [line]
      while (index + 1 < lines.length && isTableLine(lines[index + 1])) {
        index += 1
        tableLines.push(lines[index])
      }
      blocks.push(renderTable(tableLines, key, density))
      continue
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph(paragraph, blocks, key, density)
      const level = heading[1].length
      const className = density === 'compact'
        ? 'line-clamp-1 text-label-md font-semibold text-primary'
        : level === 1
          ? 'text-headline-md font-semibold text-on-surface'
          : 'border-b border-outline-variant pb-xs text-headline-sm font-semibold text-on-surface'
      blocks.push(
        <div key={key} className={density === 'compact' ? 'pt-0' : level === 1 ? 'pt-xs' : 'pt-md'}>
          {level === 1 ? <h1 className={className}>{heading[2]}</h1> : <h2 className={className}>{heading[2]}</h2>}
        </div>
      )
      continue
    }

    if (trimmed.startsWith('>')) {
      flushParagraph(paragraph, blocks, key, density)
      blocks.push(
        <blockquote
          key={key}
          className={density === 'compact'
            ? 'line-clamp-2 border-l-2 border-primary pl-sm text-body-sm leading-relaxed text-on-surface-variant'
            : 'border-l-2 border-primary pl-sm text-body-sm leading-relaxed text-on-surface-variant'}
        >
          {renderInline(trimmed.replace(/^>\s*/, ''))}
        </blockquote>
      )
      continue
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bullet) {
      flushParagraph(paragraph, blocks, key, density)
      const items = [bullet[1]]
      while (index + 1 < lines.length) {
        const next = /^[-*]\s+(.+)$/.exec(lines[index + 1].trim())
        if (!next) break
        index += 1
        items.push(next[1])
      }
      blocks.push(
        <ul
          key={key}
          className={density === 'compact'
            ? 'list-disc space-y-0.5 pl-md text-body-sm leading-relaxed text-on-surface-variant [&>li]:line-clamp-2'
            : 'list-disc space-y-xs pl-lg text-body-md leading-relaxed text-on-surface-variant'}
        >
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
        </ul>
      )
      continue
    }

    const ordered = /^\d+[\.)]\s+(.+)$/.exec(trimmed)
    if (ordered) {
      flushParagraph(paragraph, blocks, key, density)
      const items = [ordered[1]]
      while (index + 1 < lines.length) {
        const next = /^\d+[\.)]\s+(.+)$/.exec(lines[index + 1].trim())
        if (!next) break
        index += 1
        items.push(next[1])
      }
      blocks.push(
        <ol
          key={key}
          className={density === 'compact'
            ? 'list-decimal space-y-0.5 pl-md text-body-sm leading-relaxed text-on-surface-variant [&>li]:line-clamp-2'
            : 'list-decimal space-y-xs pl-lg text-body-md leading-relaxed text-on-surface-variant'}
        >
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
        </ol>
      )
      continue
    }

    paragraph.push(line)
  }

  flushParagraph(paragraph, blocks, lines.length + blocks.length, density)
  return blocks.filter(Boolean)
}

export function DocumentMiniPreview({ node, maxLines = 9 }: { node: PrdNode; maxLines?: number }) {
  const markdown = limitMarkdownLines(buildNodeBodyMarkdown(node), maxLines)

  if (!markdown) {
    return (
      <p className="line-clamp-3 text-body-sm leading-relaxed text-on-surface-variant">
        {extractNodeSnippet(node)}
      </p>
    )
  }

  return (
    <div className="space-y-xs">
      {renderMarkdown(markdown, 'compact')}
    </div>
  )
}

export function DocumentPreview({ node, variant = 'drawer' }: DocumentPreviewProps) {
  const markdown = buildDocumentMarkdown(node)

  return (
    <article className={variant === 'full' ? 'space-y-md pb-lg' : 'space-y-md'}>
      {renderMarkdown(markdown, 'full')}
    </article>
  )
}
