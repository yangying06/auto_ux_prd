import { formatProjectArchiveError } from './archiveIO'

function assertEqual(actual: string, expected: string, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`)
}

assertEqual(
  formatProjectArchiveError(new Error('permission denied'), '保存项目存档失败'),
  'permission denied',
  'uses Error.message',
)

assertEqual(
  formatProjectArchiveError('path not allowed by scope', '保存项目存档失败'),
  'path not allowed by scope',
  'uses thrown string',
)

assertEqual(
  formatProjectArchiveError({ error: { message: 'write_file denied' } }, '保存项目存档失败'),
  'write_file denied',
  'uses nested object message',
)

assertEqual(
  formatProjectArchiveError(null, '保存项目存档失败'),
  '保存项目存档失败',
  'uses fallback for empty values',
)

console.log('archiveIO.test.ts: all assertions passed')
