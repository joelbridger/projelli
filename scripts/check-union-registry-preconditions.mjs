#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const registryPath = path.resolve('src/platform/flags/registry.ts');
const sourceText = fs.readFileSync(registryPath, 'utf8');
const prettierIgnore = fs
  .readFileSync(path.resolve('.prettierignore'), 'utf8')
  .split(/\r?\n/);
const sourceFile = ts.createSourceFile(
  registryPath,
  sourceText,
  ts.ScriptTarget.Latest,
  true
);

function fail(message) {
  console.error(`merge=union precondition failed: ${message}`);
  process.exitCode = 1;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function findFlagRegistry() {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'flagRegistry' &&
        declaration.initializer
      ) {
        return unwrap(declaration.initializer);
      }
    }
  }
  return undefined;
}

if (!prettierIgnore.includes('src/platform/flags/registry.ts')) {
  fail(
    'the flag registry must stay excluded from Prettier to preserve atomic lines.'
  );
}

const initializer = findFlagRegistry();
if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
  fail('flagRegistry must be a direct array literal.');
} else if (initializer.elements.length === 0) {
  fail('flagRegistry must not be empty.');
} else {
  const entries = [];

  for (const element of initializer.elements) {
    if (
      !ts.isCallExpression(element) ||
      !ts.isIdentifier(element.expression) ||
      element.expression.text !== 'defineFlag' ||
      element.arguments.length !== 5 ||
      !element.arguments.every(ts.isStringLiteral)
    ) {
      fail(
        'every flag entry must be defineFlag(id, description, ownerLane, createdAt, expiresAt) with literal strings.'
      );
      continue;
    }

    const startLine = sourceFile.getLineAndCharacterOfPosition(
      element.getStart(sourceFile)
    ).line;
    const endLine = sourceFile.getLineAndCharacterOfPosition(
      element.getEnd()
    ).line;
    if (startLine !== endLine) {
      fail(
        `flag descriptor ${element.arguments[0].text} spans multiple lines.`
      );
    }

    entries.push({
      id: element.arguments[0].text,
      values: element.arguments.map((argument) => argument.text),
    });
  }

  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) fail(`duplicate flag id: ${entry.id}`);
    ids.add(entry.id);
  }

  for (const entry of entries) {
    for (const value of entry.values.slice(1)) {
      if (ids.has(value) && value !== entry.id) {
        fail(
          `flag ${entry.id} references sibling flag id ${value}; registry entries must be independent.`
        );
      }
    }
  }
}

if (/flagRegistry\s*\[\s*\d+\s*\]/.test(sourceText)) {
  fail('positional flagRegistry access is forbidden; use a flag id instead.');
}

if (process.exitCode) process.exit(process.exitCode);
console.log(
  'merge=union preconditions pass: flag descriptors are literal, one-line, independent entries with no positional access.'
);
