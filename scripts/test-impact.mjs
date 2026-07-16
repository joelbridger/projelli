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

function isMergeCommit(revision) {
  return git(['rev-list', '--parents', '-n', '1', revision]).trim().split(/\s+/).length > 2;
}

function config() {
  return JSON.parse(readFileSync(path.join(root, 'scripts/test-impact-always-run.json'), 'utf8'));
}

// Declared-dependency manifest (the lever-b fallback). A test whose reverse
// import graph reaches a capability-granting API is opaque and always-run
// UNLESS it has a reviewed entry here. See scripts/test-impact-manifest.json
// for the exact contract; entries are validated in applyDeclaredManifest.
function declaredManifestConfig() {
  return JSON.parse(readFileSync(path.join(root, 'scripts/test-impact-manifest.json'), 'utf8'));
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
  let hasUnknownDynamicImport = false;

  // Filesystem access is a capability, not a particular call spelling. A test
  // whose graph can import one of these modules may inspect any local source at
  // runtime, so it is always run. This deliberately covers aliases, namespace
  // imports, CommonJS, dynamic imports, and local re-exports without trying to
  // recognize readFile/readFileSync call sites.
  const filesystemModules = new Set(['node:fs', 'node:fs/promises', 'fs', 'fs/promises', 'fs-extra']);
  let filesystemCapability = false;

  // Reproduced (REVIEW-speedup-b-REDESIGN-VERDICT.md, then REVIEW-speedup-b-
  // MANIFEST-VERDICT.md): a test can read a production source file's raw text
  // without ever importing an fs module -- via child_process,
  // worker_threads, createRequire, or process.getBuiltinModule.
  //
  // An earlier version of this file tried to be cleverer about createRequire
  // and Worker: resolve the *specifier they're called with* (the required
  // id; the worker's script path) into a real graph edge, instead of
  // blanket-flagging the import. That recognition re-entered the exact
  // "rename erases meaning" game this tool has lost five times before --
  // MANIFEST-VERDICT reproduced it end to end: `const cr = createRequire;
  // cr(x)('node:fs')` and `const W = Worker; new W(...)` both aliased the
  // *function itself* (not its result), which no amount of "track one more
  // alias level" closes (`const cr2 = cr`, `[createRequire][0]`, `({cr:
  // createRequire}).cr` all escape the same way).
  //
  // The fix that actually ends the regress: capability is keyed to whether
  // the module was imported AT ALL, never to how the caller names or calls
  // what it got back. An import specifier can't be aliased away -- `import {
  // createRequire as x } from 'node:module'` still names 'node:module' right
  // there in the specifier -- so node:child_process, node:worker_threads, and
  // node:module are all blanket capability signals, same spirit as the fs set
  // above. This gives up the (illusory) precision of resolving createRequire
  // calls to their exact target specifier or Worker calls to their exact
  // script path; the declared-dependency manifest is how a reviewed test
  // using one of these for a legitimate, non-reading purpose gets narrowed
  // back down (see scripts/test-impact-manifest.json -- e.g. the three
  // eslint-plugin-lantern-* tests, which use createRequire(import.meta.url)
  // for real ESM/CJS interop and are manifest-declared to their rule file
  // instead of relying on this recognition).
  //
  // process.getBuiltinModule needs no import at all (process is a Node
  // global), so it cannot be keyed to a specifier; it is matched on the
  // call-site property name alone, further below -- a receiver can be
  // aliased (`const p = process; p.getBuiltinModule(...)`) but the property
  // name `getBuiltinModule` cannot be, so that recognition does not reopen
  // the same regress.
  const escapeVectorModules = new Set([
    'node:child_process', 'child_process',
    'node:worker_threads', 'worker_threads',
    'node:module', 'module',
  ]);
  let escapeVectorCapability = false;

  function recordImport(specifier) {
    imports.add(specifier);
    if (filesystemModules.has(specifier)) filesystemCapability = true;
    if (escapeVectorModules.has(specifier)) escapeVectorCapability = true;
  }

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      recordImport(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && first) {
        if (ts.isStringLiteralLike(first)) recordImport(first.text);
        else hasUnknownDynamicImport = true;
      }
      // process.getBuiltinModule(...) needs no import (process is ambient), so
      // it cannot be caught by recordImport. Match on the property name alone
      // (not the receiver) -- see the block comment above for why that is
      // enough, unlike the createRequire/Worker call-site recognition this
      // replaced.
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'getBuiltinModule') {
        escapeVectorCapability = true;
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
    ts.forEachChild(node, visit);
  }
  visit(source);
  const capabilitySuspect = filesystemCapability || escapeVectorCapability;
  return {
    imports: [...imports],
    filesystemCapability,
    escapeVectorCapability,
    capabilitySuspect,
    opaque: capabilitySuspect,
    unresolved: hasUnknownDynamicImport,
  };
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
  const filesystemCapabilityModules = new Set();
  const escapeVectorCapabilityModules = new Set();
  const runtimeDiscoveryModules = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const parsed = staticImports(current);
    if (parsed.filesystemCapability) filesystemCapabilityModules.add(current);
    if (parsed.escapeVectorCapability) escapeVectorCapabilityModules.add(current);
    if (parsed.unresolved) runtimeDiscoveryModules.add(current);
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
  }
  return { reverse, filesystemCapabilityModules, escapeVectorCapabilityModules, runtimeDiscoveryModules };
}

// Clone a reverse-dependency graph's Sets so edges added for one call (e.g.
// declared-manifest waivers) never leak into a graph object a caller might
// reuse or inspect afterward.
function cloneReverseGraph(reverse) {
  const clone = new Map();
  for (const [key, parents] of reverse) clone.set(key, new Set(parents));
  return clone;
}

// The lever-b fallback: a capability-suspect test stays opaque/always-run
// UNLESS it has a reviewed entry in scripts/test-impact-manifest.json naming
// its true out-of-import-graph dependencies (possibly none, for a capability
// import reviewed as unrelated to reading arbitrary source). Declared
// dependencies become direct edges into the reverse graph, so the test then
// narrows exactly like an ordinary import -- selected only when a declared
// file (or its own import graph) changes.
//
// Entries for a test file outside `testFiles` are silently ignored: callers
// may legitimately ask about a narrow subset of the suite (e.g. a single
// fixture in the selector's own tests), and a manifest entry for a file that
// subset doesn't include is not this call's concern. When `testFiles` is the
// real, complete git-tracked test list (the only case that governs an actual
// selection), every entry is checked for real: an unknown path is a typo, and
// an entry for a test that is not currently capability-suspect is stale and
// must be removed rather than silently ignored.
export function applyDeclaredManifest(capabilitySuspectTests, declaredManifest, testFiles, reverse) {
  const entries = declaredManifest.entries ?? {};
  const waived = new Set();
  const augmented = cloneReverseGraph(reverse);
  for (const [testFile, entry] of Object.entries(entries)) {
    if (!testFiles.includes(testFile)) continue;
    if (!capabilitySuspectTests.has(testFile)) {
      throw new Error(`Declared-dependency manifest entry for ${testFile} is stale: it is not capability-suspect. Remove the entry.`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      throw new Error(`Declared-dependency manifest entry for ${testFile} is missing a reason.`);
    }
    if (!Array.isArray(entry.dependencies) || entry.dependencies.some((dependency) => typeof dependency !== 'string')) {
      throw new Error(`Declared-dependency manifest entry for ${testFile} must have a dependencies array of file paths.`);
    }
    waived.add(testFile);
    for (const dependency of entry.dependencies) {
      const dependencyAbsolute = absolute(dependency);
      if (!existsSync(dependencyAbsolute)) {
        throw new Error(`Declared-dependency manifest entry for ${testFile} names a file that does not exist: ${dependency}`);
      }
      const parents = augmented.get(dependencyAbsolute) ?? new Set();
      parents.add(absolute(testFile));
      augmented.set(dependencyAbsolute, parents);
    }
  }
  const opaqueTests = new Set([...capabilitySuspectTests].filter((testFile) => !waived.has(testFile)));
  return { opaqueTests, reverse: augmented };
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
  const filesystemCapabilityTestFiles = testsAffectedBy([...graph.filesystemCapabilityModules].map(relative), testFiles, graph.reverse);
  const escapeVectorCapabilityTestFiles = testsAffectedBy([...graph.escapeVectorCapabilityModules].map(relative), testFiles, graph.reverse);
  const capabilitySuspectTestFiles = new Set([...filesystemCapabilityTestFiles, ...escapeVectorCapabilityTestFiles]);
  const { opaqueTests, reverse } = applyDeclaredManifest(capabilitySuspectTestFiles, declaredManifestConfig(), testFiles, graph.reverse);
  const selected = testsAffectedBy(changedFiles, testFiles, reverse);
  for (const testFile of opaqueTests) selected.add(testFile);
  return {
    testFiles: [...selected].sort(),
    opaque: opaqueTests.size > 0 || graph.runtimeDiscoveryModules.size > 0,
    filesystemCapabilityTestFiles: [...filesystemCapabilityTestFiles].sort(),
    escapeVectorCapabilityTestFiles: [...escapeVectorCapabilityTestFiles].sort(),
    opaqueTestFiles: [...opaqueTests].sort(),
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
    if (isMergeCommit(parsedRange.head)) {
      return fullResult(tests, parsedRange.range, 'Merge commit range requires the full suite.', manifest);
    }
    if (changes.some(({ file }) => manifest.fullSuiteTriggers.includes(file))) {
      return fullResult(tests, parsedRange.range, 'A full-suite trigger changed.', manifest);
    }
    const selected = new Set(manifest.testFiles);
    for (const testFile of tests) if (changed.has(testFile)) selected.add(testFile);
    const options = compilerOptions();
    const graph = buildReverseDependencyGraph(tests, options);
    const filesystemCapabilityTests = testsAffectedBy([...graph.filesystemCapabilityModules].map(relative), tests, graph.reverse);
    const escapeVectorCapabilityTests = testsAffectedBy([...graph.escapeVectorCapabilityModules].map(relative), tests, graph.reverse);
    const capabilitySuspectTests = new Set([...filesystemCapabilityTests, ...escapeVectorCapabilityTests]);
    if ((graph.filesystemCapabilityModules.size > 0 || graph.escapeVectorCapabilityModules.size > 0) && capabilitySuspectTests.size === 0) {
      return fullResult(tests, parsedRange.range, 'Capability-granting modules have no reachable test coverage; full suite required.', manifest);
    }
    const opaqueSafetyTests = testsAffectedBy([...graph.runtimeDiscoveryModules].map(relative), tests, graph.reverse);
    if (graph.runtimeDiscoveryModules.size > 0 && opaqueSafetyTests.size === 0) {
      return fullResult(tests, parsedRange.range, 'Runtime-discovered dependencies have no reachable test coverage; full suite required.', manifest);
    }
    const declaredManifest = declaredManifestConfig();
    // `tests` is the complete, real, git-tracked test universe here (unlike a
    // caller of selectTestsForChanges/applyDeclaredManifest that may
    // deliberately pass a narrower subset). Any manifest key absent from it is
    // unambiguously a typo or a stale reference to a renamed/deleted test --
    // never a legitimate out-of-scope entry -- so it must be a loud error
    // here, not the silent skip applyDeclaredManifest uses for narrower
    // callers.
    for (const testFile of Object.keys(declaredManifest.entries ?? {})) {
      if (!tests.includes(testFile)) {
        throw new Error(`Declared-dependency manifest entry references a file that is not a currently tracked test: ${testFile}`);
      }
    }
    const { opaqueTests, reverse } = applyDeclaredManifest(capabilitySuspectTests, declaredManifest, tests, graph.reverse);
    for (const testFile of opaqueTests) selected.add(testFile);
    for (const testFile of opaqueSafetyTests) selected.add(testFile);
    for (const testFile of testsAffectedBy(changes.map(({ file }) => file), tests, reverse)) selected.add(testFile);
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
      reasons: ['Static import graph reached one or more changed local modules (or the always-run safety net).', 'Always-run manifest, capability-suspect test graphs (fs modules and the child_process/worker_threads/node:module/getBuiltinModule escape vectors), declared-dependency manifest waivers, and runtime-discovery coverage included.'],
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
