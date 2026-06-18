import assert from 'node:assert/strict'
import { normalizeAiProviderError } from './aiProviderError'

const usageLimit = normalizeAiProviderError(new Error('429 {"error":{"message":"litellm.RateLimitError: RateLimitError: OpenAIException - {\\"error\\":{\\"type\\":\\"usage_limit_reached\\",\\"message\\":\\"The usage limit has been reached\\",\\"plan_type\\":\\"pro\\",\\"resets_at\\":1781694994,\\"eligible_promo\\":null,\\"resets_in_seconds\\":657}}. Received Model Group=gpt-5.5","type":"throttling_error","param":null,"code":"429"}}'))

assert.equal(usageLimit.status, 429)
assert.equal(usageLimit.code, 'usage_limit_reached')
assert.equal(usageLimit.retryAfterSeconds, 657)
assert.equal(usageLimit.modelGroup, 'gpt-5.5')
assert.match(usageLimit.message, /额度已用尽/)
assert.match(usageLimit.message, /约 11 分钟/)
assert.match(usageLimit.message, /CLAUDE_MODEL/)

const plainRateLimit = normalizeAiProviderError(new Error('HTTP 429: throttling_error'))
assert.equal(plainRateLimit.status, 429)
assert.equal(plainRateLimit.code, 'rate_limited')
assert.match(plainRateLimit.message, /限流/)

const authError = normalizeAiProviderError(new Error('401 invalid api key'))
assert.equal(authError.status, 401)
assert.equal(authError.code, 'auth_error')

console.log('aiProviderError.test.ts: all assertions passed')
