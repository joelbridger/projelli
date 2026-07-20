import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
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

test('the real backend tree is clean', () => {
  const dirty = [];
  for (const rel of trackedBackendSources(repoRoot)) {
    for (const v of scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'))) dirty.push(`${rel}:${v.line} [${v.rule}]`);
  }
  assert.deepEqual(dirty, []);
});
