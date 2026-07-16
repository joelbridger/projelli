import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const registryPath = path.resolve('src/platform/flags/registry.ts');

function unwrap(node) {
  while (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    node = node.expression;
  return node;
}

function stringProperty(node, name) {
  const property = node.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
        (ts.isStringLiteral(candidate.name) && candidate.name.text === name))
  );
  if (
    !property ||
    !ts.isPropertyAssignment(property) ||
    !ts.isStringLiteral(property.initializer)
  ) {
    throw new Error(
      `Flag registry entry is missing string property \"${name}\".`
    );
  }
  return property.initializer.text;
}

function falseProperty(node) {
  const property = node.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === 'defaultEnabled'
  );
  if (
    !property ||
    !ts.isPropertyAssignment(property) ||
    property.initializer.kind !== ts.SyntaxKind.FalseKeyword
  ) {
    throw new Error('Every flag must declare defaultEnabled: false.');
  }
  return false;
}

function callDescriptor(node) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'defineFlag' ||
    node.arguments.length !== 5 ||
    !node.arguments.every(ts.isStringLiteral)
  ) {
    throw new Error(
      'Every flag registry entry must be an object literal or defineFlag(id, description, ownerLane, createdAt, expiresAt) with literal strings.'
    );
  }
  const [id, description, ownerLane, createdAt, expiresAt] = node.arguments;
  return {
    id: id.text,
    description: description.text,
    ownerLane: ownerLane.text,
    createdAt: createdAt.text,
    expiresAt: expiresAt.text,
    defaultEnabled: false,
  };
}

/** Reads the TypeScript registry without maintaining a second inventory. */
export function readFlagRegistrySource(sourceText, filePath = registryPath) {
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find(
      (candidate) =>
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === 'flagRegistry'
    );
  const initializer =
    declaration?.initializer && unwrap(declaration.initializer);
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new Error(`Could not find the flagRegistry array in ${filePath}.`);
  }
  return initializer.elements.map((element) => {
    if (ts.isCallExpression(element)) return callDescriptor(element);
    if (!ts.isObjectLiteralExpression(element))
      throw new Error('Every flag registry entry must be an object literal or defineFlag(...) call.');
    return {
      id: stringProperty(element, 'id'),
      description: stringProperty(element, 'description'),
      ownerLane: stringProperty(element, 'ownerLane'),
      createdAt: stringProperty(element, 'createdAt'),
      expiresAt: stringProperty(element, 'expiresAt'),
      defaultEnabled: falseProperty(element),
    };
  });
}

export function readFlagRegistry(filePath = registryPath) {
  return readFlagRegistrySource(fs.readFileSync(filePath, 'utf8'), filePath);
}
