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
    normalized.endsWith('/src/web-demo/demoAIProvider.ts') ||
    normalized.endsWith('/src/platform/privacy/promptPreparation.ts')
  );
}

function isTestFile(fileName) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalize(fileName));
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

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require audited egress wrapper for provider AI calls',
    },
    messages: {
      directSend:
        'Use a sendPrepared*WithEgressAudit(...) helper for cloud provider calls so prompt preparation and audit receipts cannot be skipped.',
    },
    schema: [],
  },
  create(context) {
    // Tests intentionally exercise rejected direct calls. Runtime source is
    // the protected boundary; test code is verified separately by Vitest.
    if (isAllowedFile(context.getFilename()) || isTestFile(context.getFilename())) return {};
    return {
      CallExpression(node) {
        if (isGuardedProviderCall(node)) {
          context.report({ node, messageId: 'directSend' });
        }
      },
    };
  },
};
