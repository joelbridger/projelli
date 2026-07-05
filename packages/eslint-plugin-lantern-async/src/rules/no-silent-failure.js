'use strict';

const { ESLintUtils } = require('@typescript-eslint/utils');
const { isPromiseLike } = require('@typescript-eslint/type-utils');

// A "bare" control-flow statement carries no information about *what
// happened* — `return;` / `break;` / `continue;` with no value. A `return`
// WITH a value (e.g. `return { ok: false, reason: 'auth_failed' }`) is
// explicitly communicating failure to the caller and must not be flagged —
// only the argument-less form silently discards the error.
function isBareControlFlowStatement(stmt) {
  if (stmt.type === 'ReturnStatement') return stmt.argument === null;
  return stmt.type === 'BreakStatement' || stmt.type === 'ContinueStatement';
}

function isTrivialCatchBody(blockStatement) {
  const statements = blockStatement.body;
  if (statements.length === 0) return true;
  if (statements.length === 1 && isBareControlFlowStatement(statements[0])) return true;
  return false;
}

// `.catch(() => {})`, `.catch(() => true)`, `.catch(function () { return null })`, etc:
// a rejection handler whose entire body is empty or a single literal/void return.
function isSwallowingHandler(fn) {
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return false;

  if (fn.body.type !== 'BlockStatement') {
    // Concise arrow body, e.g. `.catch(() => true)` / `.catch(() => undefined)`.
    return isSwallowedValue(fn.body);
  }

  const statements = fn.body.body;
  if (statements.length === 0) return true;
  if (statements.length === 1 && statements[0].type === 'ReturnStatement') {
    const arg = statements[0].argument;
    return arg === null || isSwallowedValue(arg);
  }
  return false;
}

function isSwallowedValue(node) {
  if (node.type === 'Literal') return true; // true / false / null / 0 / ''
  if (node.type === 'Identifier' && node.name === 'undefined') return true;
  if (node.type === 'UnaryExpression' && node.operator === 'void') return true;
  return false;
}

// Does this call chain have a `.catch(...)` anywhere in it? Not just as the
// outermost call — `save().catch(report).finally(cleanup)` already handles
// the rejection even though `.finally` is outermost, so walk leftward through
// the member-call chain looking for `.catch` before giving up.
function chainHasCatch(node) {
  let current = node;
  while (current && current.type === 'CallExpression') {
    const callee = current.callee;
    if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
      break;
    }
    if (callee.property.name === 'catch') return true;
    current = callee.object;
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow catch blocks and promise rejection handlers that swallow a failure without logging it, setting an error state, or re-throwing — and floating `void` promises with no attached .catch().',
      recommended: false,
    },
    messages: {
      emptyCatch:
        'Empty catch block silently swallows the error. Log it, set an error state, or re-throw — or add `// eslint-disable-next-line lantern-async/no-silent-failure -- <reason>` for a genuine best-effort case.',
      trivialCatch:
        'Catch block only {{statement}}s without using the error — the failure is silently discarded. Log it, set an error state, or re-throw — or add `// eslint-disable-next-line lantern-async/no-silent-failure -- <reason>` for a genuine best-effort case.',
      swallowingCatchHandler:
        '.catch() handler discards the rejection without logging it or setting an error state. Handle it, or add `// eslint-disable-next-line lantern-async/no-silent-failure -- <reason>` for a genuine best-effort case.',
      floatingVoidPromise:
        '`void` promise has no attached .catch() — a rejection is silently dropped. Add `.catch(...)` to handle failure, or add `// eslint-disable-next-line lantern-async/no-silent-failure -- <reason>` for a genuine best-effort case.',
    },
    schema: [],
  },
  create(context) {
    // Type-aware check so `void syncCleanup()` (a plain synchronous call) isn't
    // flagged as a dropped promise — only `void` on something that actually
    // returns a thenable is a floating-promise risk. Falls back to "assume
    // promise" if this file isn't linted with type information (no tsconfig
    // project configured), since that's the strictly safer default.
    function isPromiseReturningCall(node) {
      let services;
      try {
        services = ESLintUtils.getParserServices(context, true);
      } catch {
        return true;
      }
      if (!services.program) return true;
      const type = services.getTypeAtLocation(node);
      return isPromiseLike(services.program, type);
    }

    return {
      CatchClause(node) {
        if (node.body.type !== 'BlockStatement') return;
        const statements = node.body.body;

        if (statements.length === 0) {
          context.report({ node: node.body, messageId: 'emptyCatch' });
          return;
        }

        if (isTrivialCatchBody(node.body)) {
          const kind = statements[0].type.replace('Statement', '').toLowerCase();
          context.report({
            node: statements[0],
            messageId: 'trivialCatch',
            data: { statement: kind },
          });
        }
      },

      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'catch' &&
          node.arguments.length === 1 &&
          isSwallowingHandler(node.arguments[0])
        ) {
          context.report({ node: node.arguments[0], messageId: 'swallowingCatchHandler' });
        }
      },

      UnaryExpression(node) {
        if (node.operator !== 'void') return;
        const arg = node.argument;
        if (arg.type !== 'CallExpression') return;
        if (chainHasCatch(arg)) return;
        if (!isPromiseReturningCall(arg)) return;
        context.report({ node, messageId: 'floatingVoidPromise' });
      },
    };
  },
};
