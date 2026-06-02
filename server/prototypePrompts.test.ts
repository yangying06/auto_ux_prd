import assert from 'node:assert/strict'
import {
  buildVariantConfigs,
  clampVariantCount,
  DEFAULT_CREATE_VARIANTS,
  MAX_VARIANTS,
  VARIANT_FOCUS,
  VARIANT_TEMPERATURES,
} from './prototypePrompts'

// clampVariantCount bounds and fallback
assert.equal(clampVariantCount(4, DEFAULT_CREATE_VARIANTS), 4)
assert.equal(clampVariantCount(2, DEFAULT_CREATE_VARIANTS), 2)
assert.equal(clampVariantCount(0, DEFAULT_CREATE_VARIANTS), 1, 'min clamp to 1')
assert.equal(clampVariantCount(99, DEFAULT_CREATE_VARIANTS), MAX_VARIANTS, 'max clamp')
assert.equal(clampVariantCount(null, DEFAULT_CREATE_VARIANTS), DEFAULT_CREATE_VARIANTS, 'null -> fallback')
assert.equal(clampVariantCount(undefined, 2), 2, 'undefined -> fallback')
assert.equal(clampVariantCount(2.9, DEFAULT_CREATE_VARIANTS), 2, 'floor')

// buildVariantConfigs assigns distinct focus + temperature per variant
const configs = buildVariantConfigs(4)
assert.equal(configs.length, 4)
assert.deepEqual(configs.map((c) => c.index), [0, 1, 2, 3])
assert.deepEqual(configs.map((c) => c.focus), VARIANT_FOCUS.slice(0, 4))
assert.deepEqual(configs.map((c) => c.temperature), VARIANT_TEMPERATURES.slice(0, 4))
// distinct temperatures => diversity lever in place
assert.equal(new Set(configs.map((c) => c.temperature)).size, 4, 'temperatures distinct')
assert.equal(new Set(configs.map((c) => c.focus)).size, 4, 'focuses distinct')

// smaller count still works
assert.equal(buildVariantConfigs(2).length, 2)
assert.equal(buildVariantConfigs(1).length, 1)

// update variants can rotate focus/temperature without changing response indexes
const offsetConfigs = buildVariantConfigs(2, 1)
assert.deepEqual(offsetConfigs.map((c) => c.index), [0, 1])
assert.deepEqual(offsetConfigs.map((c) => c.focus), VARIANT_FOCUS.slice(1, 3))

console.log('prototypePrompts.test.ts: all assertions passed')
