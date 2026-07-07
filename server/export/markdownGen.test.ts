import {
  generateIndexMarkdown,
  normalizePrototypeHtmlExports,
  uniqueExportPath,
} from './markdownGen'
import type { PrdNode } from '../../src/types/prdNode'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function assertMatch(actual: string, pattern: RegExp, message: string) {
  if (!pattern.test(actual)) throw new Error(`${message}: ${pattern} not found in ${actual}`)
}

const prototypeExports = normalizePrototypeHtmlExports([
  { nodeId: 'PAGE-A', label: 'Entry', html: '<main>Entry</main>' },
  { nodeId: 'PAGE-B', label: 'Blank', html: '   ' },
  null,
])

assertEqual(prototypeExports.length, 1, 'blank prototype HTML is not exported')
assertEqual(prototypeExports[0]?.nodeId ?? '', 'PAGE-A', 'prototype export keeps node id')
assertEqual(prototypeExports[0]?.html ?? '', '<main>Entry</main>', 'prototype export keeps HTML')

assertEqual(
  uniqueExportPath('prototypes/PAGE-A.html', { 'prototypes/PAGE-A.html': new Uint8Array() }),
  'prototypes/PAGE-A-2.html',
  'unique export path preserves html extension',
)

const pageNode: PrdNode = {
  id: 'PAGE-A',
  parentId: null,
  label: 'Entry',
  summary: 'Entry screen',
  content: '',
  type: 'page',
  status: 'done',
  level: 0,
  order: 0,
  needsPolish: false,
  extractedFrom: null,
  techNotes: null,
  children: [],
}
const indexMarkdown = generateIndexMarkdown(
  [pageNode],
  { [pageNode.id]: pageNode },
  new Map([[pageNode.id, 'PAGE-A.md']]),
  [],
  { prototypeIndexPath: 'prototypes/PROTOTYPE-INDEX.md', prototypeCount: 1 },
)

assertMatch(indexMarkdown, /HTML 原型附件/u, 'package index includes prototype attachment section')
assertMatch(indexMarkdown, /prototypes\/PROTOTYPE-INDEX\.md/u, 'package index links prototype manifest')

console.log('markdownGen.test.ts: all assertions passed')
