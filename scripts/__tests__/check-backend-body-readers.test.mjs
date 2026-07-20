import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RULE_IDS,
  runCheck,
  scanSource,
  trackedBackendSources,
  validateAllowlistIntegrity,
  REQUEST_TYPE_ALLOWED,
  STREAM_TYPE_ALLOWED,
  RAW_READ_ALLOWED,
  STREAM_DRAIN_ALLOWED,
} from '../check-backend-body-readers.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE = 'backend/src/routes/probe.ts';
const rules = (source, path = ROUTE) => [...new Set(scanSource(path, source).map((v) => v.rule))].sort();

/**
 * THE CORPUS IS THE TABLE.
 *
 * Every drain-shape table in every report is RENDERED from this same JSON by
 * `scripts/render-drain-corpus.mjs`, and `backend/test/drain-corpus.test.ts`
 * EXECUTES these same `source` strings against a real envelope. The previous
 * revision kept the table in a markdown report and the probes in this file, and
 * 21 of 23 probes silently carried an `as any` the table did not print — so
 * three cells claimed "REFUSED" for a shape the checker was never shown, and it
 * was the cast, not the shape, that fired the rule. A cell can no longer say one
 * thing while the probe tests another, because they are the same bytes.
 */
const corpus = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/drain-shape-corpus.json'), 'utf8')).shapes;

test('every corpus shape is detected by exactly the rules it claims — which rule, never a count', () => {
  assert.ok(corpus.length >= 60, 'the corpus must not silently shrink');
  for (const shape of corpus) {
    assert.deepEqual(
      rules(shape.source, shape.path),
      shape.expectRules,
      `${shape.id} (${shape.group}): the checker no longer refuses this shape for the reason the corpus records`,
    );
  }
});

/**
 * A count is not an identification, and a rule with no sole witness has no proof
 * it goes red for ITS OWN reason. A reviewer deleted the handler member rule
 * wholesale and the previous self-test still read 13/0, because probe #1
 * asserted `rules(source).length > 0` — satisfied by whichever OTHER rule the
 * probe's stray cast happened to fire. This is the structural replacement: every
 * declared rule must have a shape that NO other rule detects, so deleting that
 * rule turns exactly one named assertion red.
 */
test('every declared rule has a shape detected by that rule AND NO OTHER', () => {
  const soleWitness = new Map();
  for (const shape of corpus) {
    if (shape.expectRules.length === 1) soleWitness.set(shape.expectRules[0], shape.id);
  }
  const missing = RULE_IDS.filter((id) => !soleWitness.has(id));
  assert.deepEqual(missing, [], 'these rules can be deleted without a specific red');
});

/**
 * The declared inventory and what the checker actually emits are derived
 * independently and must agree. The checker itself THROWS on an undeclared rule
 * id (see `scanSource`), so this pair closes both directions: a rule that is
 * declared but unreachable reds here, and a rule that is reachable but
 * undeclared reds the moment it fires.
 */
test('the rule inventory matches what the corpus actually makes the checker emit', () => {
  const emitted = new Set();
  for (const shape of corpus) for (const rule of scanSource(shape.path, shape.source)) emitted.add(rule.rule);
  assert.deepEqual([...emitted].sort(), [...RULE_IDS].sort());
});

/**
 * THE REVIEWER'S END-TO-END BYPASS, AS A TEST.
 *
 * Review A defeated the previous positive allowlist with an imported function
 * merely NAMED `upgrade`: `RAW_SERVER_CALLS` matched the callee's trailing
 * identifier, the callee module was clean too (`getReader` was on no denylist),
 * and a 300 MB flood took RSS 73.9 -> 381.8 MB with the scan, the self-test and
 * `tsc` all green. The name allowlist is gone; `Request` is confined to the seam
 * as a totality, so BOTH halves of that bypass now fail closed — and renaming
 * the function cannot help, because no name is allowlisted anywhere.
 */
test("review A's imported-`upgrade` bypass fails closed, in server.ts and in the callee module", () => {
  const server = `import { upgrade } from "./lib/streamAudit.ts";
export function build(){ return { fetch: async (rawReq: Request, srv: unknown) => { await upgrade(rawReq); return undefined } } }`;
  const found = rules(server, 'backend/src/server.ts');
  assert.ok(found.includes('request-type-annotation'), 'naming Request outside the seam must fail closed');
  assert.ok(found.includes('bun-serve-fetch-confinement'), 'a hand-written fetch handler must fail closed');

  // Renaming the callee cannot help: there is no allowlisted name to hit.
  for (const name of ['upgrade', 'requestIP', 'prepareHttpRequest', 'somethingElse']) {
    const renamed = server.replaceAll('upgrade', name);
    assert.ok(rules(renamed, 'backend/src/server.ts').includes('request-type-annotation'), `renaming to ${name} must not help`);
  }

  // The same shape WITHOUT any `Request` annotation — contextually typed by Bun,
  // which is exactly how a future refactor would reintroduce it.
  const untyped = `import { upgrade } from "./lib/streamAudit.ts";
export function build(){ return { fetch: async (rawReq, srv) => { await upgrade(rawReq); return undefined } } }`;
  assert.deepEqual(rules(untyped, 'backend/src/server.ts'), ['bun-serve-fetch-confinement']);

  // And the callee module the reviewer wrote — clean under the old six-name
  // denylist, refused twice now.
  const callee = `type Streamish = { readonly body: ReadableStream<Uint8Array> | null };
export async function upgrade(source: Streamish): Promise<number> {
  if (!source.body) return 0;
  const reader = source.body.getReader();
  let total = 0;
  for(;;){ const c = await reader.read(); if (c.done) break; if (c.value) total += c.value.byteLength }
  return total;
}`;
  assert.deepEqual(rules(callee, 'backend/src/lib/streamAudit.ts'), ['no-stream-drain', 'stream-type-annotation']);
});

test('the seam is the ONE file allowed to name a raw Request', () => {
  assert.deepEqual([...REQUEST_TYPE_ALLOWED.keys()], ['backend/src/lib/requestBody.ts']);
  // server.ts lost its exemption when it lost its raw parameter.
  assert.ok(rules('export function h(r: Request){ return r }', 'backend/src/server.ts').includes('request-type-annotation'));
  assert.deepEqual(rules('export function h(r: Request){ return r }', 'backend/src/lib/requestBody.ts'), []);
});

test('parse diagnostics fail closed with the compiler message', () => {
  const violations = scanSource(ROUTE, 'export const swallowed = `\nawait (req as Request).text();');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'parse-failure');
  assert.match(violations[0].message, /TS1160: Unterminated template literal/);
});

test('tsx, mts, cts, and declaration sources are parsed as real scope', () => {
  for (const ext of ['tsx', 'mts', 'cts', 'd.ts']) {
    const violations = scanSource(`backend/src/routes/probe.${ext}`, 'export async function h(req: Request){ return req.text() }');
    assert.ok(violations.length > 0, `.${ext} must be checked`);
  }
});

/**
 * The test above proves the PARSER handles those extensions. It does not prove
 * the SCANNER ever reaches such a file — the previous gate's exact defect was
 * a scope filter that skipped `.mts`/`.cts`/`.tsx` while `tsc` compiled them,
 * and a parser-level test cannot see that. This one puts a real file of each
 * extension on disk and drives the REAL script end to end.
 */
test('a real .mts / .cts / .tsx handler on disk is scanned and refused', () => {
  const script = resolve(repoRoot, 'scripts/check-backend-body-readers.mjs');
  const run = () => spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run().status, 0, 'control: the tree must be green before each probe');

  for (const ext of ['mts', 'cts', 'tsx']) {
    const rel = `backend/src/routes/__scope_probe.${ext}`;
    const abs = resolve(repoRoot, rel);
    writeFileSync(abs, 'export async function h(req: Request){ return await req.text() }\n');
    try {
      assert.ok(trackedBackendSources(repoRoot).includes(rel), `.${ext} must be inside the scan scope`);
      const r = run();
      assert.notEqual(r.status, 0, `.${ext} handler must make the real script exit non-zero`);
      assert.match(`${r.stdout}${r.stderr}`, new RegExp(`__scope_probe\\.${ext}`), `.${ext} must be named in the output`);
    } finally {
      rmSync(abs, { force: true });
    }
  }
  assert.equal(run().status, 0, 'the tree is green again once the probes are removed');
});

test('an empty scan is refused, never reported as a pass', () => {
  const empty = mkdtempSync(resolve(tmpdir(), 'body-readers-empty-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: empty });
    // R-30: the shared derivation refuses EARLIER than the old per-checker
    // copy did — a repository with no backend project cannot produce a scope at
    // all, so it throws on the derivation instead of returning [] and reaching
    // the empty-scan refusal one step later. Both are refusals; neither is a pass.
    assert.throws(() => trackedBackendSources(empty), /refusing to derive a file scope/);
    assert.throws(() => runCheck(empty, { log() {}, error() {} }),
      /refusing to derive a file scope|refusing to report a pass on an empty scan/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

/**
 * SCOPE COMES FROM THE COMPILER, NOT FROM GIT — AND THIS IS THE PROOF.
 *
 * `git ls-files --cached --others --exclude-standard` is a proxy for "what gets
 * compiled" and it diverges: `--exclude-standard` honours `.gitignore`, and the
 * root `.gitignore`'s bare `dist` already shadows `backend/src/dist/`. A reviewer
 * put a `req: Request` + `req.text()` file there and the scan printed
 * "✅ 39 files ... totality boundary intact", exit 0, while `tsc` compiled 40.
 * This test asserts BOTH halves executably: git still cannot see the file, and
 * the checker now does.
 */
test('a .gitignore-hidden source that the compiler compiles is inside the scan scope', () => {
  const rel = 'backend/src/dist/__scope_probe_ignored.ts';
  const abs = resolve(repoRoot, rel);
  const script = resolve(repoRoot, 'scripts/check-backend-body-readers.mjs');
  const run = () => spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run().status, 0, 'control: green before the probe');

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, 'export async function leak(req: Request){ return await req.text() }\n');
  try {
    // git genuinely cannot see it — this is the fail-open that used to matter.
    const gitScope = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'backend/src'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0').filter(Boolean);
    assert.ok(!gitScope.includes(rel), 'precondition: git must still be blind to it, or this test proves nothing');

    assert.ok(trackedBackendSources(repoRoot).includes(rel), 'the compiler-derived scope must see it');
    const r = run();
    assert.notEqual(r.status, 0, 'a gitignored drain must make the real script exit non-zero');
    assert.match(`${r.stdout}${r.stderr}`, /__scope_probe_ignored\.ts/);
  } finally {
    rmSync(dirname(abs), { recursive: true, force: true });
  }
  assert.equal(run().status, 0, 'green again once the probe is removed');
});

test('the scan scope is a superset of every TypeScript file on disk under backend/src', () => {
  const onDisk = execFileSync('find', ['backend/src', '-type', 'f', '-name', '*.ts'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter(Boolean).sort();
  const scoped = new Set(trackedBackendSources(repoRoot));
  assert.deepEqual(onDisk.filter((p) => !scoped.has(p)), [], 'a file on disk that the scan never opens is a fail-open');
});

test('a symlink under backend/src is refused, never followed', () => {
  const rel = 'backend/src/routes/__scope_probe_link.ts';
  const abs = resolve(repoRoot, rel);
  symlinkSync('/etc/hostname', abs);
  try {
    assert.throws(() => trackedBackendSources(repoRoot), /symlink to a file outside the repository/);
  } finally {
    rmSync(abs, { force: true });
  }
});

test('allowlists have exact growth locks and a fourth entry is refused', () => {
  validateAllowlistIntegrity();
  for (const [name, map, probe] of [
    ['REQUEST_TYPE_ALLOWED', REQUEST_TYPE_ALLOWED, 'backend/src/routes/webhooks.ts'],
    ['STREAM_TYPE_ALLOWED', STREAM_TYPE_ALLOWED, 'backend/src/routes/webhooks.ts'],
    ['RAW_READ_ALLOWED', RAW_READ_ALLOWED, 'backend/src/routes/webhooks.ts'],
    ['STREAM_DRAIN_ALLOWED', STREAM_DRAIN_ALLOWED, 'backend/src/routes/webhooks.ts'],
  ]) {
    map.set(probe, 'Reviewer probe with a deliberately long but unauthorized justification string.');
    try {
      assert.throws(() => validateAllowlistIntegrity(), new RegExp(`${name} changed outside its reviewed lock`));
    } finally {
      map.delete(probe);
    }
  }
  validateAllowlistIntegrity();
  assert.deepEqual([...REQUEST_TYPE_ALLOWED.keys()].sort(), ['backend/src/lib/requestBody.ts']);
  assert.deepEqual([...STREAM_TYPE_ALLOWED.keys()].sort(), ['backend/src/lib/assured.ts', 'backend/src/lib/requestBody.ts']);
  assert.deepEqual([...RAW_READ_ALLOWED.keys()].sort(), [
    'backend/src/lib/docusignSigning/jwtGrant.ts',
    'backend/src/lib/oidc.ts',
    'backend/src/lib/requestBody.ts',
  ]);
  assert.deepEqual([...STREAM_DRAIN_ALLOWED.keys()].sort(), [
    'backend/src/lib/assured.ts',
    'backend/src/lib/requestBody.ts',
    'backend/src/routes/assured.ts',
  ]);
});

/**
 * GUARD-OF-GUARDS: a comment may only HURT this gate, never help it.
 * The rules are AST-driven, so comments are trivia — but "it is AST-based" is an
 * argument, and an argument is not a proof. Both directions, real `scanSource`.
 */
test('comments cannot fabricate a violation', () => {
  assert.deepEqual(rules('// await (req as any).clone().body\nexport const ok = 1;'), []);
  assert.deepEqual(rules('/* await Bun.readableStreamToText((req as any).body) */\nexport const ok = 1;'), []);
  assert.deepEqual(rules('/** @example async function h(req: HttpRequest){ await req.text() } */\nexport const ok = 1;'), []);
  assert.deepEqual(rules('export const doc = "await (req as Request).text()";'), []);
});

test('comments cannot suppress a violation', () => {
  const suppressions = [
    '/* eslint-disable */',
    '// check-backend-body-readers: allow',
    '// @ts-expect-error',
    '/* istanbul ignore next */',
    '// SAFE: reviewed, outbound only, justified at length by a reviewer.',
  ];
  for (const lead of suppressions) {
    const violated = rules(`${lead}\nasync function h(req: HttpRequest){ await (req as any).clone() }`);
    assert.ok(violated.includes('handler-request-cast'), `"${lead}" must not suppress the finding`);
  }
  assert.ok(rules('async function h(req: HttpRequest){ await (req as any).clone() } // reviewed')
    .includes('handler-request-cast'));
  assert.ok(rules('async function h(req: HttpRequest){ /* a */ await (req as any).clone() /* b */ }')
    .includes('handler-request-cast'));
});

test('an untracked, not-yet-added source file is inside the scan scope', () => {
  const rel = 'backend/src/routes/__scope_probe_untracked.ts';
  const abs = resolve(repoRoot, rel);
  assert.equal(existsSync(abs), false, 'probe path must not already exist');
  writeFileSync(abs, 'export async function h(req: Request){ return await req.text() }\n');
  try {
    assert.ok(trackedBackendSources(repoRoot).includes(rel), 'an untracked backend source must be scanned, not skipped');
    const found = rules(readFileSync(abs, 'utf8'), rel);
    assert.ok(found.includes('request-type-annotation'));
    assert.ok(found.includes('no-raw-body-drain'));
  } finally {
    rmSync(abs, { force: true });
  }
});

/**
 * GUARD-OF-GUARDS: every error path must make the check RED. A prior AST gate
 * in this repo exited 0 on an unparseable file, so every green it printed was
 * worthless. These drive the REAL script as a subprocess and assert the exit
 * code, not an internal function's return value.
 */
test('every failure path exits non-zero when the real script runs', () => {
  const script = resolve(repoRoot, 'scripts/check-backend-body-readers.mjs');
  const run = (env) => {
    const r = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  assert.equal(run({}).code, 0);

  const cases = [
    ['unparseable source', 'backend/src/routes/__fail_parse.ts', 'export const swallowed = `\nawait (req as Request).text();'],
    ['unknown file type', 'backend/src/routes/__fail_ext.txt', 'not typescript'],
  ];
  for (const [label, rel, body] of cases) {
    const abs = resolve(repoRoot, rel);
    writeFileSync(abs, body);
    try {
      const { code, out } = run({});
      assert.notEqual(code, 0, `${label} must fail closed`);
      assert.ok(/refusing|failing closed/i.test(out), `${label} must say why: ${out}`);
    } finally {
      rmSync(abs, { force: true });
    }
  }

  // The compiler cannot be reached -> the scope cannot be derived -> refuse.
  const noTsc = run({ PATH: '/nonexistent' });
  assert.notEqual(noTsc.code, 0, 'an unusable toolchain must not be read as an empty scan');

  const unreadable = resolve(repoRoot, 'backend/src/routes/__fail_perm.ts');
  writeFileSync(unreadable, 'export const x = 1;\n');
  chmodSync(unreadable, 0o000);
  try {
    assert.notEqual(run({}).code, 0, 'an unreadable source must fail closed');
  } finally {
    chmodSync(unreadable, 0o644);
    rmSync(unreadable, { force: true });
  }

  assert.equal(run({}).code, 0);
});

test('the real backend tree is clean', () => {
  const dirty = [];
  for (const rel of trackedBackendSources(repoRoot)) {
    for (const v of scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'))) dirty.push(`${rel}:${v.line} [${v.rule}]`);
  }
  assert.deepEqual(dirty, []);
});

test('the corpus file is the only place shapes are written down', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const relPath = relative(repoRoot, resolve(repoRoot, 'scripts/drain-shape-corpus.json'));
  assert.ok(self.includes(relPath), 'this test file must read the corpus rather than restate it');
  const runtimeTest = readFileSync(resolve(repoRoot, 'backend/test/drain-corpus.test.ts'), 'utf8');
  assert.ok(runtimeTest.includes('drain-shape-corpus.json'), 'the runtime regression test must read the SAME corpus file');
});
