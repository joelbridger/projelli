import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../../../packages/eslint-plugin-lantern-test-hygiene/src/rules/require-open-world-platform-flags-mock.js');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
});

ruleTester.run('require-open-world-platform-flags-mock', rule, {
  valid: [
    `import { mockPlatformFlags } from '@/testing/platform-flags';
     vi.mock('@/platform/flags', async (importOriginal) => mockPlatformFlags(importOriginal, flags));`,
    `const { mockPlatformFlags } = await vi.hoisted(async () => import('@/testing/platform-flags'));
     vi.mock('@/platform/flags', async (importOriginal) => mockPlatformFlags(importOriginal, flags));`,
    "vi.mock('@/platform/flags', async (importOriginal) => ({ ...(await importOriginal()), useFlag: () => true }));",
    "vi.mock('@/platform/flags/router', () => ({ useFlag: () => true }));",
    "vi.mock('@/features/crm-home', () => ({ useHome: () => true }));",
  ],
  invalid: [
    {
      code: "vi.mock('@/platform/flags', () => ({ useFlag: () => true }));",
      errors: [{ messageId: 'unsafePlatformFlagsMock' }],
    },
    {
      code: `vi.mock('@/platform/flags', () => ({\n  useFlag: () => true,\n  isEnabled: () => true,\n}));`,
      errors: [{ messageId: 'unsafePlatformFlagsMock' }],
    },
    {
      code: "vi.mock('@/platform/flags', async (importOriginal) => ({ useFlag: () => true }));",
      errors: [{ messageId: 'unsafePlatformFlagsMock' }],
    },
    {
      code: "vi.mock('@/platform/flags', async (importOriginal) => ({ ...overrides }));",
      errors: [{ messageId: 'unsafePlatformFlagsMock' }],
    },
  ],
});
