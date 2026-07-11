// Vitest harness for the custom ESLint rule. ESLint's RuleTester drives
// describe()/it() itself, so it must run at the top level.
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../../../packages/eslint-plugin-lantern-egress/src/rules/no-direct-provider-send.js');
const noRawNetworkCall = require('../../../packages/eslint-plugin-lantern-egress/src/rules/no-raw-network-call.js');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-raw-network-call', noRawNetworkCall, {
  valid: [
    {
      filename: '/repo/src/platform/privacy/networkClient.ts',
      code: 'fetch("https://api.openai.com"); new WebSocket("wss://api.openai.com");',
    },
    {
      filename: '/repo/src/platform/providers/AppLocalProvider.ts',
      code: 'fetch("http://127.0.0.1:18089/v1/chat/completions");',
    },
    {
      filename: '/repo/tests/unit/networkClient.test.ts',
      code: 'new EventSource("https://example.com/events");',
    },
    {
      filename: '/repo/src/web-demo/demoAIProvider.ts',
      code: 'fetch("https://example.com");',
    },
  ],
  invalid: [
    {
      filename: '/repo/src/features/ask/send.ts',
      code: 'fetch("https://api.openai.com");',
      errors: [{ messageId: 'rawNetwork' }],
    },
    {
      filename: '/repo/src/features/ask/send.ts',
      code: 'getCorsSafeFetch(); new WebSocket("wss://api.openai.com");',
      errors: [{ messageId: 'rawNetwork' }, { messageId: 'rawNetwork' }],
    },
    {
      filename: '/repo/src/features/ask/send.ts',
      code: 'new EventSource("https://api.openai.com/events");',
      errors: [{ messageId: 'rawNetwork' }],
    },
    {
      filename: '/repo/src/features/ask/send.ts',
      code: 'import { fetch as tauriFetch } from "@tauri-apps/plugin-http"; tauriFetch("https://api.openai.com");',
      errors: [{ messageId: 'rawNetwork' }],
    },
    {
      filename: '/repo/src/features/ask/send.ts',
      code: 'const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http"); tauriFetch("https://api.openai.com");',
      errors: [{ messageId: 'rawNetwork' }],
    },
    {
      filename: '/repo/src/features/ask/send.ts',
      code: "const send = globalThis['fetch']; send('https://example.com');",
      errors: [{ messageId: 'rawNetwork' }],
    },
    {
      filename: '/repo/src/features/ask/send.ts',
      code: "const Socket = globalThis.WebSocket; new Socket('wss://example.com');",
      errors: [{ messageId: 'rawNetwork' }],
    },
    {
      filename: '/repo/src/features/ask/send.ts',
      code: "const { ['fetch']: httpFetch } = await import('@tauri-apps/plugin-http'); httpFetch('https://example.com');",
      errors: [{ messageId: 'rawNetwork' }],
    },
  ],
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
