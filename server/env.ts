/**
 * Default server environment configuration.
 *
 * Single source of truth for the default values of every env var the server
 * reads. Both server/index.ts (env routes, type derivation) and server/lark/
 * (lark-cli bin / identity defaults) import from here so the two stay in sync.
 */
export const DEFAULT_ENV_CONFIG = {
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_BASE_URL: 'https://litellm.wenext.technology/',
  CLAUDE_MODEL: 'gpt-5.5',
  MOCK_DECOMPOSE: 'false',
  FIGMA_TOKEN: '',
  LARK_CLI_BIN: 'lark-cli',
  LARK_IDENTITY: 'user',
  LARK_APP_ID: '',
  LARK_APP_SECRET: '',
  LARK_TENANT_ACCESS_TOKEN: '',
  LARK_USER_ACCESS_TOKEN: '',
} as const
