import {
  beginPrototypeGeneration,
  cancelPrototypeGeneration,
  clearPrototypeGeneration,
  getActivePrototypeGenerationController,
} from './prototypeGenerationRegistry'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

const first = beginPrototypeGeneration('node-a')
if (!first) throw new Error('first generation should start')

assertEqual(getActivePrototypeGenerationController('node-a'), first, 'active controller should be returned')
assertEqual(beginPrototypeGeneration('node-a'), null, 'duplicate generation for one node should be blocked')
assertEqual(cancelPrototypeGeneration('node-a'), true, 'active generation should be cancellable')
assertEqual(first.signal.aborted, true, 'cancel should abort the controller')
assertEqual(getActivePrototypeGenerationController('node-a'), null, 'aborted controller should be cleared on lookup')

const second = beginPrototypeGeneration('node-a')
if (!second) throw new Error('new generation should start after cancellation')

clearPrototypeGeneration('node-a', new AbortController())
assertEqual(getActivePrototypeGenerationController('node-a'), second, 'clearing another controller should not affect active generation')
clearPrototypeGeneration('node-a', second)
assertEqual(getActivePrototypeGenerationController('node-a'), null, 'matching controller should clear active generation')

assertEqual(cancelPrototypeGeneration('missing-node'), false, 'missing generation should not be cancelled')

console.log('prototypeGenerationRegistry.test.ts: all assertions passed')

