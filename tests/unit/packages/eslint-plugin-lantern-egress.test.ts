// Vitest harness for the custom ESLint rule. ESLint's RuleTester drives
// describe()/it() itself, so it must run at the top level.
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../../../packages/eslint-plugin-lantern-egress/src/rules/no-direct-provider-send.js');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-direct-provider-send', rule, {
  valid: [
    {
      filename: '/repo/src/platform/privacy/sendWithEgressAudit.ts',
      code: 'provider.sendMessage(prompt, options); provider.structuredOutput(prompt, options); provider.sendMessageStreaming(prompt, options);',
    },
    {
      filename: '/repo/src/platform/providers/ClaudeProvider.ts',
      code: 'this.sendMessage(prompt, options); this.structuredOutput(prompt, options); this.sendMessageStreaming(prompt, options);',
    },
    {
      filename: '/repo/src/features/ask/useChatSending.ts',
      code: 'sendWithEgressAudit({ provider, providerId, prompt });',
    },
    {
      filename: '/repo/src/platform/rag/factsExtraction.ts',
      code: 'runWithEgressAudit({ provider, providerId, operation: () => provider.structuredOutput(prompt, options) });',
    },
  ],
  invalid: [
    {
      filename: '/repo/src/features/meetings/meetingStore.ts',
      code: 'await provider.sendMessage(prompt, options);',
      errors: [{ messageId: 'directSend' }],
    },
    {
      filename: '/repo/src/platform/rag/factsExtraction.ts',
      code: 'const result = fastProvider.sendMessage(prompt);',
      errors: [{ messageId: 'directSend' }],
    },
    {
      filename: '/repo/src/features/email/DraftFollowUpModal.tsx',
      code: 'const result = await provider.structuredOutput(prompt, options);',
      errors: [{ messageId: 'directSend' }],
    },
    {
      filename: '/repo/src/features/ask/hooks/useChatSending.ts',
      code: 'const result = await provider.sendMessageStreaming!(prompt, options);',
      errors: [{ messageId: 'directSend' }],
    },
  ],
});
