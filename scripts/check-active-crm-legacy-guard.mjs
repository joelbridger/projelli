#!/usr/bin/env node
/**
 * Guards the live CRM/client mount against accidental new Matters work.
 *
 * This intentionally checks only the active client feature and its named shell
 * mount. It does not police shared platform code or remove legacy surfaces.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { activeCrmLegacyGuardConfig } from './active-crm-legacy-guard.config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function walkSourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) walkSourceFiles(absolute, files);
    else if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension)) && !entry.endsWith('.d.ts')) files.push(absolute);
  }
  return files;
}

function sourceFile(filename) {
  return ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
}

function moduleSpecifiers(source) {
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function importsSymbolFrom(source, moduleName, symbol) {
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (statement.moduleSpecifier.text !== moduleName) return false;
    return statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === symbol);
  });
}

function mountsSymbol(source, symbol) {
  let mounted = false;
  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) && node.tagName.text === symbol
    ) mounted = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return mounted;
}

export function findActiveCrmLegacyGuardViolations(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const config = { ...activeCrmLegacyGuardConfig, ...options.config };
  const sourceRoot = path.resolve(root, config.sourceRoot);
  const allowedAdapters = new Set(config.compatibilityAdapterImports.map(([file, specifier]) => `${file}|${specifier}`));
  const violations = [];

  for (const activeRoot of config.activeClientRoots) {
    const directory = path.resolve(sourceRoot, activeRoot);
    for (const filename of walkSourceFiles(directory)) {
      const relativeFile = path.relative(root, filename).replaceAll(path.sep, '/');
      for (const specifier of moduleSpecifiers(sourceFile(filename))) {
        if (!specifier.startsWith(config.legacyFeaturePrefix)) continue;
        if (allowedAdapters.has(`${relativeFile}|${specifier}`)) continue;
        violations.push({
          file: relativeFile,
          specifier,
          message: 'Active CRM/client capability code must not import legacy Matters code. Use crm-clients registries or a documented compatibility adapter.',
        });
      }
    }
  }

  const mountFile = path.resolve(root, config.activeMount.file);
  const mountSource = sourceFile(mountFile);
  for (const legacyModule of config.legacyMountModules) {
    if (moduleSpecifiers(mountSource).includes(legacyModule)) {
      violations.push({
        file: config.activeMount.file,
        specifier: legacyModule,
        message: 'The active CRM/client shell must not mount a legacy Matters surface.',
      });
    }
  }
  if (!importsSymbolFrom(mountSource, config.activeMount.module, config.activeMount.symbol) || !mountsSymbol(mountSource, config.activeMount.symbol)) {
    violations.push({
      file: config.activeMount.file,
      specifier: config.activeMount.module,
      message: `The named active CRM/client mount is <${config.activeMount.symbol}> from ${config.activeMount.module}.`,
    });
  }

  return violations.sort((a, b) => `${a.file}|${a.specifier}`.localeCompare(`${b.file}|${b.specifier}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = findActiveCrmLegacyGuardViolations();
  if (violations.length === 0) console.log('✅ Active CRM/client boundary holds: ClientsSurface is the only named mount; documented adapters remain allowed.');
  else {
    console.error(`\n❌ Active CRM/client boundary regression: ${violations.length} finding(s):\n`);
    for (const violation of violations) console.error(`  ${violation.file}: ${violation.specifier}\n    ${violation.message}`);
  }
  process.exit(violations.length === 0 ? 0 : 1);
}
