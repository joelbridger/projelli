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

function propertyName(property, computed) {
  if (!computed) {
    return property && property.type === 'Identifier'
      ? property.name
      : undefined;
  }
  return property &&
    property.type === 'Literal' &&
    typeof property.value === 'string'
    ? property.value
    : undefined;
}

function memberName(node) {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped || unwrapped.type !== 'MemberExpression') return undefined;
  return propertyName(unwrapped.property, unwrapped.computed);
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

function isGlobalObjectMember(node, names) {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped || unwrapped.type !== 'MemberExpression') return false;
  const object = unwrapExpression(unwrapped.object);
  return (
    object &&
    object.type === 'Identifier' &&
    (object.name === 'globalThis' || object.name === 'window') &&
    names.has(memberName(unwrapped))
  );
}

function isGlobalConstructor(node) {
  const unwrapped = unwrapExpression(node);
  return (
    (unwrapped &&
      unwrapped.type === 'Identifier' &&
      (unwrapped.name === 'WebSocket' || unwrapped.name === 'EventSource')) ||
    isGlobalObjectMember(unwrapped, new Set(['WebSocket', 'EventSource']))
  );
}

// This is intentionally defense-in-depth, not the security boundary. The
// boundary is networkClient.ts plus native NetworkPolicy; this rule catches
// direct renderer mistakes and a few easy aliases, not all possible sinks.

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
    const rawFetchAliases = new WeakSet();
    const rawConstructorAliases = new WeakSet();

    function variableFor(identifier) {
      let scope = context.sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.variables.find(
          (candidate) => candidate.name === identifier.name
        );
        if (variable) return variable;
        scope = scope.upper;
      }
      return undefined;
    }

    function markAlias(identifier, aliases) {
      const variable = variableFor(identifier);
      if (variable) aliases.add(variable);
    }

    function isAlias(identifier, aliases) {
      return (
        identifier.type === 'Identifier' && aliases.has(variableFor(identifier))
      );
    }

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
        isGlobalConstructor(callee) || isAlias(callee, rawConstructorAliases)
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
        if (node.id.type === 'Identifier') {
          if (isGlobalObjectMember(init, new Set(['fetch']))) {
            markAlias(node.id, rawFetchAliases);
          } else if (isGlobalConstructor(init)) {
            markAlias(node.id, rawConstructorAliases);
          }
        }

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
            propertyName(property.key, property.computed) === 'fetch' &&
            property.value.type === 'Identifier'
          ) {
            tauriHttpFetchBindings.add(property.value.name);
          }
        }
      },
      CallExpression(node) {
        if (
          isRawFetch(node.callee) ||
          isAlias(unwrapExpression(node.callee), rawFetchAliases) ||
          isTauriHttpFetch(node.callee)
        ) {
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
