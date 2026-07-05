// Vitest harness for the custom ESLint rule. ESLint's RuleTester drives
// describe()/it() itself, so it must run at the top level (not inside another
// describe/it block). The rule lives in a workspace package so flat config
// can `require` it without any build step.
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../../../packages/eslint-plugin-lantern-async/src/rules/no-silent-failure.js');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-silent-failure', rule, {
  valid: [
    // Re-throws — caller still finds out.
    { code: 'try { risky(); } catch (e) { throw e; }' },
    { code: 'try { risky(); } catch (e) { throw new Error("wrapped: " + e); }' },
    // Logs the error.
    { code: 'try { risky(); } catch (e) { console.error(e); }' },
    { code: 'try { risky(); } catch (e) { logger.error("failed", e); return; }' },
    // Sets an error/UI state — the failure surfaces to the user.
    { code: 'try { risky(); } catch (e) { setError(e); }' },
    { code: 'try { risky(); } catch (e) { state.status = "failed"; }' },
    // Non-trivial single statement (still does *something* with the error).
    { code: 'try { risky(); } catch (e) { retryQueue.push(e); }' },
    // A `return` WITH a value explicitly communicates failure to the caller
    // (a Result-style discriminated return) — this must not be flagged, only
    // the argument-less bare `return;` form silently discards the error.
    { code: 'function f() { try { risky(); } catch { return { ok: false, reason: "auth_failed" }; } }' },
    { code: 'function f() { try { risky(); } catch { return null; } }' },
    { code: 'function f() { try { risky(); } catch { return "fallback"; } }' },
    // .catch() that actually handles the rejection.
    { code: 'doThing().catch((e) => console.error(e));' },
    { code: 'doThing().catch((e) => setError(e));' },
    { code: 'doThing().catch(handleError);' },
    // void promise with an attached .catch() is not floating.
    { code: 'void doThing().catch((e) => console.error(e));' },
    // .catch() handled even when it isn't the outermost call in the chain.
    { code: 'void doThing().catch((e) => console.error(e)).finally(() => cleanup());' },
    { code: 'void doThing().catch((e) => console.error(e)).then(() => onDone());' },
    // void on a non-call expression is out of scope for this rule.
    { code: 'void 0;' },
    // eslint-disable escape hatch is a normal suppression, not a rule concern —
    // RuleTester doesn't need a case for it; it's handled by ESLint core.
  ],
  invalid: [
    // Empty catch block.
    {
      code: 'try { risky(); } catch (e) { }',
      errors: [{ messageId: 'emptyCatch' }],
    },
    {
      code: 'try { risky(); } catch { }',
      errors: [{ messageId: 'emptyCatch' }],
    },
    // Bare return, nothing else — the error is discarded.
    {
      code: 'try { risky(); } catch (e) { return; }',
      errors: [{ messageId: 'trivialCatch' }],
    },
    {
      code: 'for (;;) { try { risky(); } catch (e) { continue; } }',
      errors: [{ messageId: 'trivialCatch' }],
    },
    {
      code: 'for (;;) { try { risky(); } catch (e) { break; } }',
      errors: [{ messageId: 'trivialCatch' }],
    },
    // .catch(() => {}) and equivalents.
    {
      code: 'doThing().catch(() => {});',
      errors: [{ messageId: 'swallowingCatchHandler' }],
    },
    {
      code: 'doThing().catch(function () {});',
      errors: [{ messageId: 'swallowingCatchHandler' }],
    },
    {
      code: 'doThing().catch(() => true);',
      errors: [{ messageId: 'swallowingCatchHandler' }],
    },
    {
      code: 'doThing().catch(() => null);',
      errors: [{ messageId: 'swallowingCatchHandler' }],
    },
    {
      code: 'doThing().catch(() => undefined);',
      errors: [{ messageId: 'swallowingCatchHandler' }],
    },
    {
      code: 'doThing().catch(() => { return false; });',
      errors: [{ messageId: 'swallowingCatchHandler' }],
    },
    // Floating void promise with no .catch anywhere in the chain.
    {
      code: 'void doThing();',
      errors: [{ messageId: 'floatingVoidPromise' }],
    },
    {
      code: 'function onClick() { void submitForm(payload); }',
      errors: [{ messageId: 'floatingVoidPromise' }],
    },
    // .finally() alone doesn't handle the rejection — no .catch anywhere in the chain.
    {
      code: 'void doThing().finally(() => cleanup());',
      errors: [{ messageId: 'floatingVoidPromise' }],
    },
  ],
});
