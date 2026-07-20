import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanSource, backendSources, PRIVILEGED_REGISTRY } from '../check-backend-privileged-routes.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = PRIVILEGED_REGISTRY;
const server = 'backend/src/server.ts';
const rules = (source, path = registry) => scanSource(path, source).map((v) => v.rule).sort();
const valid = `definePrivilegedRoute({ id: "x", method: "POST", path: "/admin/x", auth: "admin", purpose: "test", handler: (req) => ok(req) });`;

test('accepts a complete inline privileged route with declared admin auth', () => {
  assert.deepEqual(rules(valid), []);
});
test('catches a privileged route with no declared auth', () => {
  const v = scanSource(registry, `definePrivilegedRoute({ id: "x", method: "POST", path: "/admin/x", purpose: "test", handler: h });`);
  assert.ok(v.some((row) => row.rule === 'declared-auth-required'));
  assert.match(v.find((row) => row.rule === 'declared-auth-required').message, /auth: "admin"/);
});

test('catches auth supplied through a cast', () => {
  assert.ok(rules(`definePrivilegedRoute(({ id: "x", method: "POST", path: "/admin/x", handler: h }) as PrivilegedRouteDefinition);`).includes('no-route-definition-cast'));
});

test('catches a route hidden in a renamed variable', () => {
  assert.deepEqual(rules(`const renamed = { id: "x", method: "POST", path: "/admin/x", auth: "admin", purpose: "test", handler: h }; definePrivilegedRoute(renamed);`), ['inline-route-definition-required']);
});

test('catches a spread that can overwrite auth', () => {
  assert.ok(rules(`definePrivilegedRoute({ ...base, id: "x", method: "POST", path: "/admin/x", auth: "admin", purpose: "test", handler: h });`).includes('no-route-definition-spread'));
});

test('catches auth supplied by a variable instead of an approved literal', () => {
  assert.ok(rules(`definePrivilegedRoute({ id: "x", method: "POST", path: "/admin/x", auth: chosenAuth, purpose: "test", handler: h });`).includes('declared-auth-required'));
});

test('a comment cannot hide a real missing-auth registration', () => {
  const source = `// auth: "admin"\n/* definePrivilegedRoute({ auth: "admin" }) */\ndefinePrivilegedRoute({ id: "x", method: "POST", path: "/admin/x", purpose: "test", handler: h });`;
  assert.equal(rules(source).filter((r) => r === 'declared-auth-required').length, 1);
});

test('comments and strings alone do not create route registrations', () => {
  const source = `// definePrivilegedRoute({ path: "/admin/x" })\nconst docs = "definePrivilegedRoute({ auth: admin }) /admin/x";`;
  assert.deepEqual(rules(source), []);
});

test('catches direct dispatch of a privileged handler outside the registry', () => {
  assert.deepEqual(rules(`if (x) return handleCreateOrg(req, store);`, server), ['no-direct-privileged-dispatch']);
});

test('allows the registry itself to call privileged handlers', () => {
  assert.deepEqual(rules(`const h = () => handleCreateOrg(req, store);`, registry), []);
});

test('catches raw /admin route registration in server.ts', () => {
  assert.deepEqual(rules(`if (path === "/admin/new" && method === "POST") return h(req);`, server), ['no-raw-privileged-route']);
});

test('catches a raw known non-/admin privileged route in server.ts', () => {
  assert.deepEqual(rules(`if (path === "/assured/keys/set") return h(req);`, server), ['no-raw-privileged-route']);
});

test('catches a brand-new raw path even before its privilege is known', () => {
  assert.deepEqual(rules(`if (path === "/brand-new-sensitive") return h(req);`, server), ['new-raw-route-requires-declaration']);
});

test('catches a brand-new dynamic route suffix', () => {
  assert.deepEqual(rules(`if (match.rest === "brand-new-sensitive") return h(req);`, server), ['new-raw-route-requires-declaration']);
});

test('allows a frozen legacy public path while rejecting direct privileged handlers separately', () => {
  assert.deepEqual(rules(`if (path === "/healthz") return health();`, server), []);
});

test('a string documenting a privileged path is not a raw route registration', () => {
  assert.deepEqual(rules(`const docs = "POST /admin/org";`, server), []);
});

test('reports the correct line for a missing auth declaration', () => {
  const v = scanSource(registry, `// one\n// two\ndefinePrivilegedRoute({ id: "x", method: "POST", path: "/admin/x", purpose: "test", handler: h });`);
  assert.equal(v.find((row) => row.rule === 'declared-auth-required').line, 3);
});

/**
 * R-30. This test used to assert `scope === git ls-files -- backend/src`. That
 * assertion did not merely fail to catch the index-scoped blind spot — it
 * WELDED it in place: any correct fix to the checker made its own self-test
 * red, so the test was an argument for keeping the defect. The property that
 * matters is not "the scope equals the index"; it is "the scope is at least
 * every backend source on disk, INCLUDING the ones git cannot see".
 */
test('scope is a strict superset of the git index and covers untracked files', () => {
  const actual = backendSources(repoRoot).files.sort();
  const indexed = execFileSync('git', ['ls-files', '--', 'backend/src'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter((path) => path.endsWith('.ts')).sort();
  assert.ok(actual.length > 20, 'a scope this small is a broken derivation, not a small backend');
  for (const file of indexed) assert.ok(actual.includes(file), `index-tracked file missing from scope: ${file}`);
  assert.ok(actual.includes(PRIVILEGED_REGISTRY));

  // The blind shape, asserted rather than assumed: a file that exists on disk
  // and is absent from the git index MUST be in scope.
  const probe = resolve(repoRoot, 'backend/src/__r30_scope_probe__.ts');
  writeFileSync(probe, 'export const probe = 1;\n');
  try {
    assert.equal(
      execFileSync('git', ['ls-files', '--', 'backend/src/__r30_scope_probe__.ts'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      '',
      'the probe must be untracked for this assertion to mean anything',
    );
    assert.ok(
      backendSources(repoRoot).files.includes('backend/src/__r30_scope_probe__.ts'),
      'an untracked backend source must be in scope; a git-index scope would miss it',
    );
  } finally {
    rmSync(probe, { force: true });
  }
});

test('the real backend tree has no privileged-route registration violations', () => {
  const dirty = [];
  for (const rel of backendSources(repoRoot).files) {
    for (const v of scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'))) dirty.push(`${rel}:${v.line} [${v.rule}]`);
  }
  assert.deepEqual(dirty, []);
});
