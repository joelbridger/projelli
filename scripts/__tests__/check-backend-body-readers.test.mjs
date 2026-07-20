/**
 * The guard's own guard.
 *
 * A completeness mechanism inherits the illusion it was built to end unless it
 * is itself attacked. These cases feed `scanSource` the exact shapes that beat a
 * naive text-matching check — a violation hidden in a comment, a violation
 * hidden in a string, a cast that hands the body members back — and assert the
 * AST checker gets each one right. If this file goes green while the checker has
 * quietly stopped detecting anything, the assertions on the POSITIVE cases fail.
 *
 * Run: npm run backend:body-readers:test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scanSource,
  trackedBackendSources,
  REQUEST_TYPE_ALLOWED,
  RAW_READ_ALLOWED,
} from '../check-backend-body-readers.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const A_ROUTE = 'backend/src/routes/example.ts';
const THE_SEAM = 'backend/src/lib/requestBody.ts';

const rules = (vs) => vs.map((v) => v.rule).sort();

// ---------------------------------------------------------------------------
// It CATCHES the real defect shapes
// ---------------------------------------------------------------------------

test('catches a raw req.text() in a route', () => {
  const v = scanSource(A_ROUTE, `export async function h(req: HttpRequest) { const t = await req.text(); return t; }`);
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, 'no-raw-body-drain');
  assert.match(v[0].message, /readCappedText/);
});

test('catches every body-draining method, not just text()', () => {
  for (const m of ['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes']) {
    const v = scanSource(A_ROUTE, `async function h(req) { return await req.${m}(); }`);
    assert.equal(v.length, 1, `expected .${m}() to be caught`);
    assert.equal(v[0].rule, 'no-raw-body-drain');
  }
});

test('catches a drain through a renamed variable (not keyed on the name `req`)', () => {
  const v = scanSource(A_ROUTE, `async function h(r) { const incoming = r; return await incoming.arrayBuffer(); }`);
  assert.deepEqual(rules(v), ['no-raw-body-drain']);
});

test('catches `req: Request` — the "declare the full type to get the members back" bypass', () => {
  const v = scanSource(A_ROUTE, `export function h(req: Request): Response { return new Response(req.url); }`);
  assert.deepEqual(rules(v), ['request-type-confinement']);
  assert.match(v[0].message, /HttpRequest/);
});

test('catches an `as Request` cast — the "cast the body members back on" bypass', () => {
  const v = scanSource(A_ROUTE, `async function h(req: HttpRequest) { const s = (req as Request).body; return s; }`);
  assert.deepEqual(rules(v), ['request-type-confinement']);
});

test('catches an angle-bracket <Request> assertion too', () => {
  const v = scanSource(A_ROUTE, `function h(req: HttpRequest) { return (<Request>req).bodyUsed; }`);
  assert.deepEqual(rules(v), ['request-type-confinement']);
});

test('catches `new Request(...)` inside backend/src', () => {
  const v = scanSource(A_ROUTE, `function forge(u: string) { return new Request(u, { method: "POST" }); }`);
  assert.deepEqual(rules(v), ['request-type-confinement']);
});

test('catches Request in a generic / return / alias position, not only a parameter', () => {
  assert.deepEqual(rules(scanSource(A_ROUTE, `type H = (r: Request) => Response;`)), ['request-type-confinement']);
  assert.deepEqual(rules(scanSource(A_ROUTE, `function f(): Promise<Request> { throw 1; }`)), ['request-type-confinement']);
  assert.deepEqual(rules(scanSource(A_ROUTE, `const q: Array<Request> = [];`)), ['request-type-confinement']);
});

test('reports BOTH rules when a cast is used to drain the body', () => {
  const v = scanSource(A_ROUTE, `async function h(req: HttpRequest) { return await (req as Request).text(); }`);
  assert.deepEqual(rules(v), ['no-raw-body-drain', 'request-type-confinement']);
});

test('reports the correct line number', () => {
  const v = scanSource(A_ROUTE, ['// one', '// two', 'async function h(req) {', '  return await req.text();', '}'].join('\n'));
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 4);
});

// ---------------------------------------------------------------------------
// It is NOT defeated by comments or strings, and does not FIRE on them either
// (a text-match check gets both of these wrong)
// ---------------------------------------------------------------------------

test('a violation is not hidden by putting real code after a comment that mentions it', () => {
  const src = [
    '// Do not use req.text() here — it buffers the whole body.',
    '/* req.json() is also forbidden. */',
    'async function h(req) { return await req.text(); }',
  ].join('\n');
  const v = scanSource(A_ROUTE, src);
  assert.equal(v.length, 1, 'exactly the real call, not the two comment mentions');
  assert.equal(v[0].line, 3);
});

test('a comment alone does NOT trigger the checker', () => {
  const src = ['// historical note: this route used to call req.text() and req.arrayBuffer().', 'export const x = 1;'].join('\n');
  assert.deepEqual(scanSource(A_ROUTE, src), []);
});

test('a string literal mentioning the API does NOT trigger the checker', () => {
  const src = `export const HINT = "never call req.text(); use readCappedText"; export const T = \`req.json()\`;`;
  assert.deepEqual(scanSource(A_ROUTE, src), []);
});

test('the word Request inside an identifier or string is not a type reference', () => {
  const src = `export type HttpRequest = { url: string }; const label = "Request"; export function f(r: HttpRequest) { return r.url; }`;
  assert.deepEqual(scanSource(A_ROUTE, src), []);
});

// ---------------------------------------------------------------------------
// The exclusions are real, scoped, and not accidental blanket passes
// ---------------------------------------------------------------------------

test('the seam module itself may use Request and drain a body', () => {
  const src = `export async function read(req: HttpRequest) { return await (req as Request).text(); }`;
  assert.deepEqual(scanSource(THE_SEAM, src), []);
});

test('an outbound-Response allowlist entry may call .json() but NOT name Request', () => {
  const oidc = 'backend/src/lib/oidc.ts';
  assert.ok(RAW_READ_ALLOWED.has(oidc));
  assert.equal(REQUEST_TYPE_ALLOWED.has(oidc), false);
  assert.deepEqual(scanSource(oidc, `async function f(r: Response) { return await r.json(); }`), []);
  assert.deepEqual(rules(scanSource(oidc, `function f(req: Request) { return req.url; }`)), ['request-type-confinement']);
});

test('server.ts may hold a concrete Request but may NOT drain it', () => {
  const server = 'backend/src/server.ts';
  assert.ok(REQUEST_TYPE_ALLOWED.has(server));
  assert.equal(RAW_READ_ALLOWED.has(server), false);
  assert.deepEqual(scanSource(server, `async function fetch(req: Request) { return new Response(req.url); }`), []);
  assert.deepEqual(rules(scanSource(server, `async function fetch(req: Request) { return await req.text(); }`)), ['no-raw-body-drain']);
});

test('every allowlist entry carries a written reason', () => {
  for (const [path, reason] of [...REQUEST_TYPE_ALLOWED, ...RAW_READ_ALLOWED]) {
    assert.ok(reason.length > 40, `${path} needs a real justification, got: ${JSON.stringify(reason)}`);
  }
});

// ---------------------------------------------------------------------------
// The SCOPE is derived from ground truth, not hard-coded
// ---------------------------------------------------------------------------

test('scope is every git-tracked .ts under backend/src, and it is not empty', () => {
  const files = trackedBackendSources(repoRoot);
  assert.ok(files.length > 20, `expected the whole backend, got ${files.length} files`);
  assert.ok(files.every((f) => f.startsWith('backend/src/') && f.endsWith('.ts')));

  // Ground truth: the same set git itself reports. If the checker's scope ever
  // drifts below what git tracks, this fails rather than silently under-scanning.
  const fromGit = execFileSync('git', ['ls-files', '--', 'backend/src'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.ts'))
    .sort();
  assert.deepEqual([...files].sort(), fromGit);

  // The routes we know exist must be inside the scanned set.
  for (const f of ['backend/src/routes/webhooks.ts', 'backend/src/lib/http.ts', 'backend/src/routes/assured.ts']) {
    assert.ok(files.includes(f), `${f} must be in scope`);
  }
});

test('the real backend tree is currently clean', () => {
  const dirty = [];
  for (const rel of trackedBackendSources(repoRoot)) {
    for (const v of scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'))) {
      dirty.push(`${rel}:${v.line} [${v.rule}]`);
    }
  }
  assert.deepEqual(dirty, []);
});
