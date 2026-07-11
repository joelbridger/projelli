'use strict';

const path = require('node:path');

function normalize(fileName) {
  return fileName.split(path.sep).join('/');
}

function isAllowedFile(fileName) {
  const normalized = normalize(fileName);
  return (
    normalized.endsWith('/src/platform/privacy/networkClient.ts') ||
    normalized.endsWith('/src/platform/providers/AppLocalProvider.ts') ||
    normalized.endsWith('/src/platform/providers/OllamaProvider.ts') ||
    normalized.includes('/src/web-demo/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__fixtures__/') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)
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

function memberName(node) {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped || unwrapped.type !== 'MemberExpression' || unwrapped.computed)
    return undefined;
  return unwrapped.property && unwrapped.property.type === 'Identifier'
    ? unwrapped.property.name
    : undefined;
}

function isRawFetch(callee) {
  const unwrapped = unwrapExpression(callee);
  if (!unwrapped) return false;
  if (unwrapped.type === 'Identifier') {
    return unwrapped.name === 'fetch' || unwrapped.name === 'getCorsSafeFetch';
  }
  if (memberName(unwrapped) !== 'fetch') return false;
  const object = unwrapExpression(unwrapped.object);
  return (
    object &&
    object.type === 'Identifier' &&
    (object.name === 'globalThis' || object.name === 'window')
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require networkClient for raw renderer network calls',
    },
    messages: {
      rawNetwork:
        'Use networkClient for off-device network activity so Offline Mode cannot be bypassed.',
    },
    schema: [],
  },
  create(context) {
    if (isAllowedFile(context.getFilename())) return {};

    const tauriHttpFetchBindings = new Set();
    const tauriHttpNamespaces = new Set();

    function isTauriHttpFetch(callee) {
      const unwrapped = unwrapExpression(callee);
      if (!unwrapped) return false;
      if (unwrapped.type === 'Identifier')
        return tauriHttpFetchBindings.has(unwrapped.name);
      if (memberName(unwrapped) !== 'fetch') return false;
      const object = unwrapExpression(unwrapped.object);
      return (
        object &&
        object.type === 'Identifier' &&
        tauriHttpNamespaces.has(object.name)
      );
    }

    function isRawConstructor(node) {
      const callee = unwrapExpression(node.callee);
      return (
        callee &&
        callee.type === 'Identifier' &&
        (callee.name === 'WebSocket' || callee.name === 'EventSource')
      );
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@tauri-apps/plugin-http') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            tauriHttpNamespaces.add(specifier.local.name);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'fetch'
          ) {
            tauriHttpFetchBindings.add(specifier.local.name);
          }
        }
      },
      VariableDeclarator(node) {
        const init = unwrapExpression(node.init);
        const importExpression =
          init && init.type === 'AwaitExpression'
            ? unwrapExpression(init.argument)
            : undefined;
        if (
          !importExpression ||
          importExpression.type !== 'ImportExpression' ||
          !importExpression.source ||
          importExpression.source.value !== '@tauri-apps/plugin-http'
        ) {
          return;
        }

        if (node.id.type === 'Identifier') {
          tauriHttpNamespaces.add(node.id.name);
          return;
        }

        if (node.id.type !== 'ObjectPattern') return;
        for (const property of node.id.properties) {
          if (
            property.type === 'Property' &&
            !property.computed &&
            property.key.type === 'Identifier' &&
            property.key.name === 'fetch' &&
            property.value.type === 'Identifier'
          ) {
            tauriHttpFetchBindings.add(property.value.name);
          }
        }
      },
      CallExpression(node) {
        if (isRawFetch(node.callee) || isTauriHttpFetch(node.callee)) {
          context.report({ node, messageId: 'rawNetwork' });
        }
      },
      NewExpression(node) {
        if (isRawConstructor(node))
          context.report({ node, messageId: 'rawNetwork' });
      },
    };
  },
};
