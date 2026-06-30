// Vitest harness for the custom ESLint rule. ESLint's RuleTester drives
// describe()/it() itself, so it must run at the top level (not inside another
// describe/it block). The rule lives in a workspace package so flat config
// can `require` it without any build step.
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../../../packages/eslint-plugin-lantern-i18n/src/rules/no-hardcoded-string.js');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('no-hardcoded-string', rule, {
  valid: [
    // Already wrapped in t()
    { code: 'const C = () => <button>{t("send-button")}</button>;' },
    // Short string (under 3 alphabetic words)
    { code: 'const C = () => <span>OK</span>;' },
    { code: 'const C = () => <span>Hi there</span>;' },
    // Code/pre tags carry literal content, not copy
    { code: 'const C = () => <code>npm install keepance</code>;' },
    { code: 'const C = () => <pre>git push origin main</pre>;' },
    // Trans wrapper handles localization itself
    { code: 'const C = () => <Trans>Click here to upload a file</Trans>;' },
    // JSX expression (variable) is not JSXText
    { code: 'const C = () => <p>{message}</p>;' },
    // Numeric / non-alpha content
    { code: 'const C = () => <span>1234 5678 9012</span>;' },
  ],
  invalid: [
    {
      code: 'const C = () => <p>Click here to upload a file</p>;',
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: 'const C = () => <button>Submit your form</button>;',
      errors: [{ messageId: 'hardcoded' }],
    },
    {
      code: 'const C = () => <h1>Welcome to Keepance, friend</h1>;',
      errors: [{ messageId: 'hardcoded' }],
    },
  ],
});
