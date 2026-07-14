#!/usr/bin/env node
/**
 * Feature-boundary ratchet.
 *
 * Usage:
 *   node scripts/check-boundaries.mjs
 *   node scripts/check-boundaries.mjs --update-baseline
 *
 * The checker intentionally uses the TypeScript parser already installed by
 * this repo rather than a second lint plugin. It therefore catches normal,
 * type-only, re-export, and dynamic imports, and is also usable as a
 * standalone release-gate command.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { featureBoundaryConfig } from './feature-boundaries.config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function walkSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) walkSourceFiles(absolute, files);
    else if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension)) && !entry.endsWith('.d.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

function featureName(sourceRoot, filename) {
  const parts = path.relative(sourceRoot, filename).split(path.sep);
  return parts[0] === 'features' ? parts[1] ?? null : null;
}

function importedFeatureName(sourceRoot, importer, specifier) {
  let candidate;
  if (specifier.startsWith('@/')) candidate = path.join(sourceRoot, specifier.slice(2));
  else if (specifier.startsWith('.')) candidate = path.resolve(path.dirname(importer), specifier);
  else return null;

  const parts = path.relative(sourceRoot, candidate).split(path.sep);
  return parts[0] === 'features' ? parts[1] ?? null : null;
}

function isPublicFeatureImport(sourceRoot, importer, specifier, publicEntrypoints) {
  let candidate;
  if (specifier.startsWith('@/')) candidate = path.join(sourceRoot, specifier.slice(2));
  else if (specifier.startsWith('.')) candidate = path.resolve(path.dirname(importer), specifier);
  else return false;

  const parts = path.relative(sourceRoot, candidate).split(path.sep);
  if (parts[0] !== 'features' || !parts[1]) return false;
  // @/features/foo is the folder form of its public index module.
  if (parts.length === 2) return true;
  // TypeScript resolves the extensionless @/features/foo/index form to the
  // public index module too.
  return parts.length === 3 && (parts[2] === 'index' || publicEntrypoints.includes(parts[2]));
}

function moduleSpecifiers(sourceFile) {
  const found = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function findBoundaryViolations(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const config = { ...featureBoundaryConfig, ...options.config };
  const sourceRoot = path.resolve(root, config.sourceRoot);
  const violations = [];

  for (const filename of walkSourceFiles(sourceRoot)) {
    const owner = featureName(sourceRoot, filename);
    if (!owner) continue;
    const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const specifier of moduleSpecifiers(source)) {
      const target = importedFeatureName(sourceRoot, filename, specifier);
      const ownerTag = config.compositeFeatureTag(owner);
      const targetTag = target && config.compositeFeatureTag(target);
      if (target && targetTag !== ownerTag && !isPublicFeatureImport(sourceRoot, filename, specifier, config.publicEntrypoints)) {
        const relativeFile = path.relative(root, filename).replaceAll(path.sep, '/');
        violations.push({
          file: relativeFile,
          specifier,
          message: `${config.featureTag(ownerTag)} must import ${config.featureTag(targetTag)} only through its public index module.`,
        });
      }
    }
  }
  return violations.sort((a, b) => `${a.file}|${a.specifier}`.localeCompare(`${b.file}|${b.specifier}`));
}

export function fingerprintMap(violations) {
  const map = {};
  for (const violation of violations) {
    const key = `${violation.file}|${violation.specifier}|${violation.message}`;
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}

export function checkBoundaryBaseline({ root = repoRoot, config = featureBoundaryConfig, update = false } = {}) {
  const baselinePath = path.resolve(root, config.baselineFile);
  const current = fingerprintMap(findBoundaryViolations({ repoRoot: root, config }));
  if (update) {
    writeFileSync(baselinePath, JSON.stringify(Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
    return { ok: true, updated: true, count: Object.keys(current).length };
  }
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    return { ok: false, error: `Missing or invalid baseline: ${path.relative(root, baselinePath)}` };
  }
  const regressions = Object.entries(current)
    .filter(([key, count]) => count > (baseline[key] ?? 0))
    .map(([key, count]) => ({ key, count, baselineCount: baseline[key] ?? 0 }));
  return { ok: regressions.length === 0, count: Object.keys(current).length, regressions };
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const result = checkBoundaryBaseline({ update: process.argv.includes('--update-baseline') });
  if (result.updated) console.log(`Feature-boundary baseline updated: ${result.count} fingerprint(s).`);
  else if (result.error) console.error(`❌ ${result.error}`);
  else if (result.ok) console.log(`✅ No feature-boundary regression (${result.count} current baseline finding(s)).`);
  else {
    console.error(`\n❌ Feature-boundary regression: ${result.regressions.length} new/increased finding(s):\n`);
    for (const regression of result.regressions) console.error(`  +${regression.count - regression.baselineCount}  ${regression.key}`);
    console.error('\nMove shared code to platform, use the target feature index.ts, or deliberately refresh the baseline.');
  }
  process.exit(result.ok ? 0 : 1);
}
