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

/** Reads the TypeScript registry without maintaining a second inventory. */
export function readFlagRegistry(filePath = registryPath) {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
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
    if (!ts.isObjectLiteralExpression(element))
      throw new Error('Every flag registry entry must be an object literal.');
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
