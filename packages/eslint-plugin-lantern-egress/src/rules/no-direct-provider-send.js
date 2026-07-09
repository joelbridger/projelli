'use strict';

const path = require('node:path');

const GUARDED_METHODS = new Set([
  'sendMessage',
  'sendMessageStreaming',
  'structuredOutput',
]);

function normalize(fileName) {
  return fileName.split(path.sep).join('/');
}

function isAllowedFile(fileName) {
  const normalized = normalize(fileName);
  return (
    normalized.includes('/src/platform/providers/') ||
    normalized.includes('/src/web-demo/') ||
    normalized.endsWith('/src/platform/privacy/sendWithEgressAudit.ts')
  );
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function isGuardedProviderCall(node) {
  const callee = unwrapExpression(node.callee);
  if (!callee || callee.type !== 'MemberExpression') return false;
  if (callee.computed) return false;
  return (
    callee.property &&
    callee.property.type === 'Identifier' &&
    GUARDED_METHODS.has(callee.property.name)
  );
}

function getCalleeName(callee) {
  const unwrapped = unwrapExpression(callee);
  if (!unwrapped) return undefined;
  if (unwrapped.type === 'Identifier') return unwrapped.name;
  if (
    unwrapped.type === 'MemberExpression' &&
    !unwrapped.computed &&
    unwrapped.property &&
    unwrapped.property.type === 'Identifier'
  ) {
    return unwrapped.property.name;
  }
  return undefined;
}

function getPropertyName(property) {
  if (!property || property.computed) return undefined;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal') return String(property.key.value);
  return undefined;
}

function sourceCodeAncestors(context, node) {
  if (context.sourceCode && typeof context.sourceCode.getAncestors === 'function') {
    return context.sourceCode.getAncestors(node);
  }
  return typeof context.getAncestors === 'function' ? context.getAncestors() : [];
}

function isInsideRunWithEgressAuditOperation(context, node) {
  const ancestors = sourceCodeAncestors(context, node);
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const ancestor = ancestors[i];
    if (
      !ancestor ||
      ancestor.type !== 'Property' ||
      getPropertyName(ancestor) !== 'operation'
    ) {
      continue;
    }

    const objectExpression = ancestors[i - 1];
    const callExpression = ancestors[i - 2];
    if (
      objectExpression &&
      objectExpression.type === 'ObjectExpression' &&
      callExpression &&
      callExpression.type === 'CallExpression' &&
      callExpression.arguments.includes(objectExpression) &&
      getCalleeName(callExpression.callee) === 'runWithEgressAudit'
    ) {
      return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require audited egress wrapper for provider AI calls',
    },
    messages: {
      directSend:
        'Use sendWithEgressAudit(...) or runWithEgressAudit(...) for provider AI calls so privacy checks and audit receipts cannot be skipped.',
    },
    schema: [],
  },
  create(context) {
    if (isAllowedFile(context.getFilename())) return {};
    return {
      CallExpression(node) {
        if (
          isGuardedProviderCall(node) &&
          !isInsideRunWithEgressAuditOperation(context, node)
        ) {
          context.report({ node, messageId: 'directSend' });
        }
      },
    };
  },
};
