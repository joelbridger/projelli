'use strict';

const MESSAGE =
  'Unsafe @/platform/flags mock: missing exports can crash a transitive import. Use @/testing/platform-flags, or an async importOriginal factory that spreads the real module before overrides.';

function isFlagsMock(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'vi' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'mock' &&
    node.arguments[0]?.type === 'Literal' &&
    node.arguments[0].value === '@/platform/flags'
  );
}

function isImportOriginalCall(node, parameter) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === parameter
  );
}

function isOriginalSpread(property, parameter) {
  return (
    property.type === 'SpreadElement' &&
    property.argument.type === 'AwaitExpression' &&
    isImportOriginalCall(property.argument.argument, parameter)
  );
}

function isCanonicalHelperFactory(factory, helperLocalNames) {
  if (
    (factory.type !== 'ArrowFunctionExpression' && factory.type !== 'FunctionExpression') ||
    !factory.async ||
    factory.params[0]?.type !== 'Identifier'
  ) {
    return false;
  }

  const body = factory.body;
  const expression =
    body.type === 'BlockStatement'
      ? body.body.find((statement) => statement.type === 'ReturnStatement')?.argument
      : body;
  return (
    expression?.type === 'CallExpression' &&
    expression.callee.type === 'Identifier' &&
    helperLocalNames.has(expression.callee.name) &&
    expression.arguments[0]?.type === 'Identifier' &&
    expression.arguments[0].name === factory.params[0].name
  );
}

function isHoistedHelperImport(node) {
  if (
    node.id.type !== 'ObjectPattern' ||
    node.init?.type !== 'AwaitExpression' ||
    node.init.argument.type !== 'CallExpression'
  ) {
    return false;
  }
  const hoistedCall = node.init.argument;
  if (
    hoistedCall.callee.type !== 'MemberExpression' ||
    hoistedCall.callee.computed ||
    hoistedCall.callee.object.type !== 'Identifier' ||
    hoistedCall.callee.object.name !== 'vi' ||
    hoistedCall.callee.property.type !== 'Identifier' ||
    hoistedCall.callee.property.name !== 'hoisted'
  ) {
    return false;
  }
  const callback = hoistedCall.arguments[0];
  const expression =
    callback?.type === 'ArrowFunctionExpression' ? callback.body : undefined;
  return (
    expression?.type === 'ImportExpression' &&
    expression.source.type === 'Literal' &&
    expression.source.value === '@/testing/platform-flags'
  );
}

function hasOriginalSpread(factory) {
  if (
    (factory.type !== 'ArrowFunctionExpression' && factory.type !== 'FunctionExpression') ||
    !factory.async ||
    factory.params[0]?.type !== 'Identifier'
  ) {
    return false;
  }

  const parameter = factory.params[0].name;
  const body = factory.body;
  const object =
    body.type === 'ObjectExpression'
      ? body
      : body.type === 'BlockStatement'
        ? body.body.find((statement) => statement.type === 'ReturnStatement')?.argument
        : undefined;

  if (object?.type !== 'ObjectExpression') return false;

  let hasOriginal = false;
  let hasOverride = false;
  for (const property of object.properties) {
    if (isOriginalSpread(property, parameter)) {
      if (hasOverride) return false;
      hasOriginal = true;
    } else {
      hasOverride = true;
    }
  }
  return hasOriginal;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require open-world @/platform/flags Vitest mocks.',
      recommended: false,
    },
    messages: {
      unsafePlatformFlagsMock: MESSAGE,
    },
    schema: [],
  },
  create(context) {
    const helperLocalNames = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@/testing/platform-flags') return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'mockPlatformFlags'
          ) {
            helperLocalNames.add(specifier.local.name);
          }
        }
      },
      VariableDeclarator(node) {
        if (!isHoistedHelperImport(node)) return;
        for (const property of node.id.properties) {
          if (
            property.type === 'Property' &&
            property.key.type === 'Identifier' &&
            property.key.name === 'mockPlatformFlags' &&
            property.value.type === 'Identifier'
          ) {
            helperLocalNames.add(property.value.name);
          }
        }
      },
      CallExpression(node) {
        if (!isFlagsMock(node)) return;
        const factory = node.arguments[1];
        if (
          !factory ||
          (!hasOriginalSpread(factory) &&
            !isCanonicalHelperFactory(factory, helperLocalNames))
        ) {
          context.report({ node, messageId: 'unsafePlatformFlagsMock' });
        }
      },
    };
  },
};
