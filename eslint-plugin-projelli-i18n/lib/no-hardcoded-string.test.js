const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('./no-hardcoded-string');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('no-hardcoded-string', rule, {
  valid: [
    { code: '<button>{t("send-button")}</button>' },
    { code: '<span>OK</span>' },
    { code: '<code>{snippet}</code>' },
    { code: '<button>Send</button>' },
  ],
  invalid: [
    {
      code: '<p>Click here to upload a file</p>',
      errors: [{ message: /hardcoded/i }],
    },
    {
      code: '<button>Submit your form</button>',
      errors: [{ message: /hardcoded/i }],
    },
  ],
});

console.log('rule tests passed');
