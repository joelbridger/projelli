import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCheck,
  scanSource,
  trackedBackendSources,
  validateAllowlistIntegrity,
  REQUEST_TYPE_ALLOWED,
  RAW_READ_ALLOWED,
} from '../check-backend-body-readers.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE = 'backend/src/routes/probe.ts';
const SERVER = 'backend/src/server.ts';
const rules = (source, path = ROUTE) => scanSource(path, source).map((v) => v.rule);

test('all 23 adversarial review shapes are detected or have no inbound raw material', () => {
  const probes = [
    ['s01', 'async function h(req: HttpRequest){await req.text()}', true],
    ['s02', 'async function h(req: HttpRequest){await (req as Request).text()}', true],
    ['s03', 'async function h(req: HttpRequest){const {text}=req; await text()}', true],
    ['s04', 'async function h(req: HttpRequest){const {text}=req as any; await text.call(req)}', true],
    ['s05', 'function drain(r: Request){return r.arrayBuffer()}', true],
    ['s06', 'function drain(r:{arrayBuffer():Promise<ArrayBuffer>}){return r.arrayBuffer()}', true],
    ['s07', 'async function h(req: HttpRequest){await Request.prototype.text.call(req as any)}', true],
    ['s08', 'async function h(req: HttpRequest){await (req as any)["text"]()}', true],
    ['s09', 'async function h(req: HttpRequest){await (req as any)["te"+"xt"]()}', true],
    ['s10', 'async function h(req: HttpRequest){await Reflect.get(req as any,"text").call(req)}', true],
    ['s11', 'async function h(req: HttpRequest){await Reflect.apply((req as any).text,req,[])}', true],
    ['s12', 'async function h(req: HttpRequest){await Object.getPrototypeOf(req).text.call(req)}', false],
    ['s13', 'async function h(req: HttpRequest){await new Request(req as any).text()}', true],
    ['s14', 'async function h(req: HttpRequest){const o:any={...(req as any)};await o.text()}', true],
    ['s15', 'async function h(req: HttpRequest){await (req as unknown as Request).text()}', true],
    ['s16', 'function drain<T extends {text():Promise<string>}>(r:T){return r.text()}', true],
    ['s17', 'async function h(req: HttpRequest){const r=(req as any).body.getReader();for(;;){const x=await r.read();if(x.done)break}}', true],
    ['s18', 'async function h(req: HttpRequest){await Bun.readableStreamToText((req as any).body)}', true],
    ['s19', 'async function h(req: HttpRequest){await Bun.readableStreamToArrayBuffer((req as any).body)}', true],
    ['s20', 'async function h(req: HttpRequest){await new Response((req as any).body).text()}', true],
    ['s21', 'function get<T,K extends keyof T>(x:T,k:K){return x[k]} async function h(req:HttpRequest){await Bun.readableStreamToText(get(req as any,"body"))}', true],
    ['s22', 'declare global { interface Body { probe(): void } } export {}', false],
    ['s23', 'async function h(req: HttpRequest){const m="text";const fn=(req as any)[m];await fn.call(req)}', true],
  ];
  assert.equal(probes.length, 23);
  for (const [name, source, detected] of probes) {
    assert.equal(rules(source).length > 0, detected, `${name} detection classification changed`);
  }
});

test('the raw Bun request uses a positive allowlist, including the headline body defeat', () => {
  assert.deepEqual(rules('async function fetch(rawReq: Request){await Bun.readableStreamToText(rawReq.body)}', SERVER), ['raw-server-request-use']);
  assert.deepEqual(rules('async function fetch(rawReq: Request){const x=rawReq as any;return x}', SERVER), ['raw-server-request-use']);
  assert.deepEqual(rules('async function fetch(rawReq: Request,srv:any){return prepareHttpRequest(rawReq,1)}', SERVER), []);
  assert.deepEqual(rules('async function fetch(rawReq: Request,srv:any){return srv.upgrade(rawReq)}', SERVER), []);
});

test('parse diagnostics fail closed with the compiler message', () => {
  const violations = scanSource(ROUTE, 'export const swallowed = `\nawait (req as Request).text();');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'parse-failure');
  assert.match(violations[0].message, /TS1160: Unterminated template literal/);
});

test('tsx, mts, cts, and declaration sources are parsed as real scope', () => {
  for (const ext of ['tsx', 'mts', 'cts', 'd.ts']) {
    const violations = scanSource(`backend/src/routes/probe.${ext}`, 'export async function h(req: Request){return req.text()}');
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

/**
 * A scan that finds nothing must never be reported as a pass. This drives the
 * real script against a scope that genuinely resolves to zero files.
 */
test('an empty scan is refused, never reported as a pass', () => {
  const empty = mkdtempSync(resolve(tmpdir(), 'body-readers-empty-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: empty });
    // A real repository that genuinely has no backend/src. The refusal must be
    // a THROW, not a zero-violation "pass".
    assert.deepEqual(trackedBackendSources(empty), []);
    assert.throws(() => runCheck(empty, { log() {}, error() {} }),
      /refusing to report a pass on an empty scan/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('scope ground truth comes independently from TypeScript --listFilesOnly', () => {
  const guarded = trackedBackendSources(repoRoot).sort();
  const output = execFileSync(resolve(repoRoot, 'backend/node_modules/.bin/tsc'), ['--noEmit', '--listFilesOnly', '--pretty', 'false'], {
    cwd: resolve(repoRoot, 'backend'),
    encoding: 'utf8',
  });
  const compiled = output.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('/backend/src/'))
    .map((path) => relative(repoRoot, path).replaceAll('\\', '/'))
    .sort();
  assert.ok(compiled.length > 20);
  assert.deepEqual(guarded, compiled);
});

test('allowlists have exact growth locks and a fourth entry is refused', () => {
  validateAllowlistIntegrity();
  const path = 'backend/src/routes/webhooks.ts';
  RAW_READ_ALLOWED.set(path, 'Reviewer probe with a deliberately long but unauthorized justification string.');
  try {
    assert.throws(() => validateAllowlistIntegrity(), /RAW_READ_ALLOWED changed outside its reviewed lock/);
  } finally {
    RAW_READ_ALLOWED.delete(path);
  }
  validateAllowlistIntegrity();
  assert.deepEqual([...REQUEST_TYPE_ALLOWED.keys()].sort(), ['backend/src/lib/requestBody.ts', 'backend/src/server.ts']);
  assert.deepEqual([...RAW_READ_ALLOWED.keys()].sort(), [
    'backend/src/lib/docusignSigning/jwtGrant.ts',
    'backend/src/lib/oidc.ts',
    'backend/src/lib/requestBody.ts',
  ]);
});

/**
 * GUARD-OF-GUARDS: a comment may only HURT this gate, never help it.
 *
 * A sibling gate in this repo was once satisfied by a comment. Here the rules
 * are AST-driven, so comments are trivia and produce no nodes — but "it is
 * AST-based" is an argument, and an argument is not a proof. These cases run
 * the real `scanSource` and assert the property in both directions:
 * a comment can neither FABRICATE a finding nor SUPPRESS one.
 */
test('comments cannot fabricate a violation', () => {
  // The exact text of a real violation, but only ever inside comment trivia.
  assert.deepEqual(rules('// await (req as any).clone().body\nexport const ok = 1;'), []);
  assert.deepEqual(rules('/* await Bun.readableStreamToText((req as any).body) */\nexport const ok = 1;'), []);
  assert.deepEqual(rules('/** @example async function h(req: HttpRequest){ await req.text() } */\nexport const ok = 1;'), []);
  // A string literal is not code either.
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
    assert.ok(violated.includes('handler-request-confinement'), `"${lead}" must not suppress the finding`);
  }
  // A trailing comment on the offending line itself must not help either.
  assert.ok(rules('async function h(req: HttpRequest){ await (req as any).clone() } // reviewed')
    .includes('handler-request-confinement'));
  // Nor may a comment that closes/reopens around the offending expression.
  assert.ok(rules('async function h(req: HttpRequest){ /* a */ await (req as any).clone() /* b */ }')
    .includes('handler-request-confinement'));
});

/**
 * GUARD-OF-GUARDS: the scan must see a file that is on disk but not yet added
 * to git. Backend `tsc` compiles it and Bun runs it, so a scope that starts at
 * `--cached` is fail-open for exactly the file a developer just wrote. Proven
 * by driving the real `trackedBackendSources` against a real temp file.
 */
test('an untracked, not-yet-added source file is inside the scan scope', () => {
  const rel = 'backend/src/routes/__scope_probe_untracked.ts';
  const abs = resolve(repoRoot, rel);
  assert.equal(existsSync(abs), false, 'probe path must not already exist');
  writeFileSync(abs, 'export async function h(req: Request){ return await req.text() }\n');
  try {
    const scoped = trackedBackendSources(repoRoot);
    assert.ok(scoped.includes(rel), 'an untracked backend source must be scanned, not skipped');
    const found = scanSource(rel, readFileSync(abs, 'utf8')).map((v) => v.rule);
    assert.ok(found.includes('request-type-confinement'));
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

  // Control: the tree as committed is green, so a red below is caused by the
  // injected failure and not by a pre-existing violation.
  assert.equal(run({}).code, 0);

  const cases = [
    ['unparseable source', 'backend/src/routes/__fail_parse.ts', 'export const swallowed = `\nawait (req as Request).text();'],
    ['unknown tracked extension', 'backend/src/routes/__fail_ext.txt', 'not typescript'],
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

  // git unavailable -> the scope cannot be derived -> refuse, never assume empty.
  const noGit = run({ PATH: '/nonexistent' });
  assert.notEqual(noGit.code, 0, 'a git failure must not be read as an empty scan');

  // Unreadable source file.
  const unreadable = resolve(repoRoot, 'backend/src/routes/__fail_perm.ts');
  writeFileSync(unreadable, 'export const x = 1;\n');
  chmodSync(unreadable, 0o000);
  try {
    assert.notEqual(run({}).code, 0, 'an unreadable source must fail closed');
  } finally {
    chmodSync(unreadable, 0o644);
    rmSync(unreadable, { force: true });
  }

  // And the tree is green again afterwards, so the reds above were the probes.
  assert.equal(run({}).code, 0);
});

test('the real backend tree is clean', () => {
  const dirty = [];
  for (const rel of trackedBackendSources(repoRoot)) {
    for (const v of scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'))) dirty.push(`${rel}:${v.line} [${v.rule}]`);
  }
  assert.deepEqual(dirty, []);
});
