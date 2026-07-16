#!/usr/bin/env node

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

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

function findFlagRegistry(sourceFile) {
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

function trackedSourceFiles(repoRoot) {
  return execFileSync('git', ['ls-files', '-z', '--', 'src'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file));
}

function positionalAccessErrors(repoRoot) {
  const errors = [];
  for (const file of trackedSourceFiles(repoRoot)) {
    if (file === 'src/platform/flags/registry.ts') continue;
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const positional = source.match(/\bflagRegistry\s*\[\s*[^\]]+\s*\]/g) ?? [];
    const atCalls = source.match(/\bflagRegistry\s*\.\s*at\s*\(/g) ?? [];
    if (positional.length || atCalls.length) {
      errors.push(
        `${file} uses positional flagRegistry access (${[...positional, ...atCalls].join(', ')}).`
      );
    }
  }
  return errors;
}

export function checkUnionRegistryPreconditions({ repoRoot = process.cwd() } = {}) {
  const errors = [];
  const registryPath = path.join(repoRoot, 'src/platform/flags/registry.ts');
  const sourceText = fs.readFileSync(registryPath, 'utf8');
  const prettierIgnore = fs
    .readFileSync(path.join(repoRoot, '.prettierignore'), 'utf8')
    .split(/\r?\n/);
  const sourceFile = ts.createSourceFile(
    registryPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  if (!prettierIgnore.includes('src/platform/flags/registry.ts')) {
    errors.push(
      'the flag registry must stay excluded from Prettier to preserve atomic lines.'
    );
  }

  const initializer = findFlagRegistry(sourceFile);
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    errors.push('flagRegistry must be a direct array literal.');
  } else if (initializer.elements.length === 0) {
    errors.push('flagRegistry must not be empty.');
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
        errors.push(
          'every flag entry must be defineFlag(id, description, ownerLane, createdAt, expiresAt) with literal strings.'
        );
        if (ts.isObjectLiteralExpression(element)) {
          const idProperty = element.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === 'id' &&
              ts.isStringLiteral(property.initializer)
          );
          if (idProperty && ts.isPropertyAssignment(idProperty)) {
            entries.push({ id: idProperty.initializer.text, values: [] });
          }
        }
        continue;
      }

      const startLine = sourceFile.getLineAndCharacterOfPosition(
        element.getStart(sourceFile)
      ).line;
      const endLine = sourceFile.getLineAndCharacterOfPosition(
        element.getEnd()
      ).line;
      if (startLine !== endLine) {
        errors.push(
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
      if (ids.has(entry.id)) errors.push(`duplicate flag id: ${entry.id}`);
      ids.add(entry.id);
    }

    for (const entry of entries) {
      for (const value of entry.values.slice(1)) {
        if (ids.has(value) && value !== entry.id) {
          errors.push(
            `flag ${entry.id} references sibling flag id ${value}; registry entries must be independent.`
          );
        }
      }
    }
  }

  errors.push(...positionalAccessErrors(repoRoot));
  return errors;
}

export function main() {
  const errors = checkUnionRegistryPreconditions();
  for (const error of errors)
    console.error(`merge=union precondition failed: ${error}`);
  if (errors.length > 0) return 1;
  console.log(
    'merge=union preconditions pass: flag descriptors are literal, one-line, independent entries with no positional access anywhere in src/.'
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main();
