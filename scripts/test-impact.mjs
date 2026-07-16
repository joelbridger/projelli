#!/usr/bin/env node
/**
 * Conservative Vitest impact selection.
 *
 * A test is selected when its static import graph reaches a changed local
 * module. Selection errors deliberately return the complete suite: this tool
 * is allowed to spend extra time, never to omit proof it cannot justify.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const TEST_FILE = /^(?:tests|src)\/.*\.(?:test|spec)\.(?:ts|tsx)$/;
const EXCLUDED_TEST = /^(?:tests\/e2e|tests\/campaign)\//;
const LOCAL_EXTENSION = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function absolute(file) {
  return path.resolve(root, file);
}

function isTestFile(file) {
  return TEST_FILE.test(file) && !EXCLUDED_TEST.test(file);
}

function listTestFiles() {
  return git(['ls-files', '-z'])
    .split('\0')
    .filter(isTestFile)
    .sort();
}

function injectedFailure(stage) {
  if (process.env.TEST_IMPACT_TEST_INJECT === stage) {
    throw new Error(`Injected ${stage} failure`);
  }
}

function parseRange(range) {
  if (!range || !range.includes('..')) throw new Error('Pass --range <base>..<head>.');
  const divider = range.includes('...') ? '...' : '..';
  const [base, head] = range.split(divider);
  if (!base || !head) throw new Error(`Invalid range: ${range}`);
  return { base, head, range: `${base}${divider}${head}` };
}

function changedPaths(range) {
  const output = git(['diff', '--name-status', '-z', range]);
  const fields = output.split('\0');
  const changes = [];
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++];
    if (!status) continue;
    const first = fields[index++];
    if (!first) throw new Error(`Malformed git diff entry for ${status}`);
    if (status.startsWith('R') || status.startsWith('C')) {
      const second = fields[index++];
      if (!second) throw new Error(`Malformed rename/copy entry for ${status}`);
      // A rename deletes an import target from the old tree. Until graphing both
      // revisions is implemented, only a full run can prove this safely.
      if (status.startsWith('R')) throw new Error(`Renamed file requires full suite: ${first} -> ${second}`);
      changes.push({ status, file: second });
      continue;
    }
    if (status.startsWith('D')) throw new Error(`Deleted file requires full suite: ${first}`);
    changes.push({ status, file: first });
  }
  return changes;
}

function config() {
  return JSON.parse(readFileSync(path.join(root, 'scripts/test-impact-always-run.json'), 'utf8'));
}

function resolveSpecifier(specifier, containingFile, compilerOptions) {
  const cleaned = specifier.replace(/[?#].*$/, '');
  const resolved = ts.resolveModuleName(cleaned, containingFile, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
  if (resolved) return resolved;
  if (!cleaned.startsWith('.') && !cleaned.startsWith('@/')) return undefined;

  const candidate = cleaned.startsWith('@/')
    ? path.join(root, 'src', cleaned.slice(2))
    : path.resolve(path.dirname(containingFile), cleaned);
  // Vite's ?raw / ?url imports can point to non-code files. They still count
  // as a dependency of the importing test, but have no TypeScript imports of
  // their own to walk.
  if (existsSync(candidate)) return candidate;
  for (const extension of LOCAL_EXTENSION) {
    if (existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  }
  for (const extension of LOCAL_EXTENSION) {
    const index = path.join(candidate, `index${extension}`);
    if (existsSync(index)) return index;
  }
  throw new Error(`Cannot resolve local import ${specifier} from ${relative(containingFile)}`);
}

export function staticImports(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
  const imports = new Set();
  const fileDependencies = new Set();
  let hasUnknownDynamicImport = false;

  // Source-inspection tests often read a production file rather than import it.
  // Follow paths assembled from string literals, process.cwd(), import.meta.dirname,
  // and node:path resolve/join. Anything less definite opens the selector to the
  // complete suite instead of guessing.
  const constants = new Map();
  function constantPath(node) {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) return constants.get(node.text);
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'process'
      && node.expression.name.text === 'cwd'
      && node.arguments.length === 0) return root;
    if (ts.isPropertyAccessExpression(node)
      && ts.isMetaProperty(node.expression)
      && node.expression.keywordToken.kind === ts.SyntaxKind.ImportKeyword
      && node.name.text === 'dirname') return path.dirname(file);
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      if (callee === 'resolve' || callee === 'join') {
        const parts = node.arguments.map(constantPath);
        if (parts.some((part) => part === undefined)) return undefined;
        return callee === 'resolve' ? path.resolve(...parts) : path.join(...parts);
      }
    }
    return undefined;
  }

  function isFilesystemAccess(node) {
    if (!ts.isCallExpression(node)) return false;
    const callee = ts.isIdentifier(node.expression) ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
    return ['readFileSync', 'readFile', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'globSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].includes(callee);
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = constantPath(node.initializer);
      if (value !== undefined) constants.set(node.name.text, value);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && first) {
        if (ts.isStringLiteralLike(first)) imports.add(first.text);
        else hasUnknownDynamicImport = true;
      }
    }
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isMetaProperty(node.expression.expression)
      && node.expression.expression.keywordToken.kind === ts.SyntaxKind.ImportKeyword
      && /^glob(?:Eager)?$/.test(node.expression.name.text)) {
      // import.meta.glob and similar runtime-discovered modules are intentionally
      // not guessed. The caller opens the selector to the full suite instead.
      hasUnknownDynamicImport = true;
    }
    if (isFilesystemAccess(node)) {
      const target = node.arguments[0] ? constantPath(node.arguments[0]) : undefined;
      const callee = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      if (!target || !path.resolve(target).startsWith(`${root}${path.sep}`)
        || ['readdirSync', 'globSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].includes(callee)) {
        // Directory/glob scans, spawned checks, and runtime-computed paths
        // cannot be faithfully represented as a single graph edge.
        hasUnknownDynamicImport = true;
      } else {
        fileDependencies.add(path.resolve(target));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { imports: [...imports], fileDependencies: [...fileDependencies], opaque: hasUnknownDynamicImport };
}

function compilerOptions() {
  const parsed = ts.readConfigFile(path.join(root, 'tsconfig.test.json'), ts.sys.readFile);
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  const configResult = ts.parseJsonConfigFileContent(parsed.config, ts.sys, root);
  if (configResult.errors.length > 0) throw new Error(ts.flattenDiagnosticMessageText(configResult.errors[0].messageText, '\n'));
  return configResult.options;
}

function buildReverseDependencyGraph(testFiles, options) {
  const pending = testFiles.map(absolute);
  const visited = new Set();
  const reverse = new Map();
  const opaqueModules = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const parsed = staticImports(current);
    if (parsed.opaque) opaqueModules.add(current);
    for (const specifier of parsed.imports) {
      const resolved = resolveSpecifier(specifier, current, options);
      if (!resolved) continue;
      const local = path.resolve(resolved);
      if (!local.startsWith(`${root}${path.sep}`)) continue;
      const parents = reverse.get(local) ?? new Set();
      parents.add(current);
      reverse.set(local, parents);
      pending.push(local);
    }
    for (const dependency of parsed.fileDependencies) {
      const parents = reverse.get(dependency) ?? new Set();
      parents.add(current);
      reverse.set(dependency, parents);
    }
  }
  return { reverse, opaqueModules };
}

function testsAffectedBy(changedFiles, testFiles, reverse) {
  const tests = new Set(testFiles.map(absolute));
  const pending = changedFiles.map(absolute);
  const visited = new Set();
  const affected = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (tests.has(current)) affected.add(relative(current));
    for (const parent of reverse.get(current) ?? []) pending.push(parent);
  }
  return affected;
}

export function selectTestsForChanges({ testFiles, changedFiles }) {
  const graph = buildReverseDependencyGraph(testFiles, compilerOptions());
  return {
    testFiles: [...testsAffectedBy(changedFiles, testFiles, graph.reverse)].sort(),
    opaque: graph.opaqueModules.size > 0,
  };
}

function fullResult(testFiles, range, reason, manifest) {
  return {
    mode: 'full',
    range,
    changedFiles: [],
    testFiles,
    selectedCount: testFiles.length,
    fullCount: testFiles.length,
    reasons: [reason],
    externalGateSteps: manifest?.externalGateSteps ?? [],
  };
}

export function selectImpact({ range }) {
  let tests = [];
  let manifest;
  try {
    injectedFailure('early-selector-error');
    tests = listTestFiles();
    manifest = config();
    injectedFailure('mid-selector-error');
    const parsedRange = parseRange(range);
    const changes = changedPaths(parsedRange.range);
    const changed = new Set(changes.map(({ file }) => file));
    if (changes.some(({ file }) => manifest.fullSuiteTriggers.includes(file))) {
      return fullResult(tests, parsedRange.range, 'A full-suite trigger changed.', manifest);
    }
    const selected = new Set(manifest.testFiles);
    for (const testFile of tests) if (changed.has(testFile)) selected.add(testFile);
    const options = compilerOptions();
    const graph = buildReverseDependencyGraph(tests, options);
    if (graph.opaqueModules.size > 0) {
      return fullResult(tests, parsedRange.range, 'A runtime-discovered import or filesystem dependency requires the full suite.', manifest);
    }
    for (const testFile of testsAffectedBy(changes.map(({ file }) => file), tests, graph.reverse)) selected.add(testFile);
    for (const testFile of selected) {
      if (!tests.includes(testFile)) throw new Error(`Always-run test is missing or excluded: ${testFile}`);
    }
    return {
      mode: 'affected',
      range: parsedRange.range,
      changedFiles: changes.map(({ file }) => file),
      testFiles: [...selected].sort(),
      selectedCount: selected.size,
      fullCount: tests.length,
      reasons: ['Static import graph reached one or more changed local modules (or the always-run safety net).', 'Always-run manifest included.'],
      externalGateSteps: manifest.externalGateSteps,
    };
  } catch (error) {
    return fullResult(tests, range, `Selection error; fail open to the full suite: ${error instanceof Error ? error.message : String(error)}`, manifest);
  }
}

function main() {
  if (process.env.TEST_IMPACT_TEST_INJECT === 'empty-selector-output') return;
  if (process.env.TEST_IMPACT_TEST_INJECT === 'selector-timeout') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  const args = process.argv.slice(2);
  const rangeIndex = args.indexOf('--range');
  const range = rangeIndex >= 0 ? args[rangeIndex + 1] : 'HEAD~1..HEAD';
  const result = selectImpact({ range });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log(`Test impact: ${result.mode} (${result.selectedCount}/${result.fullCount} files)`);
  console.log(`Range: ${result.range}`);
  for (const reason of result.reasons) console.log(`- ${reason}`);
  for (const testFile of result.testFiles) console.log(testFile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
