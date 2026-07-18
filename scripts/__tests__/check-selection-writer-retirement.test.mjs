import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditSelectionWriters,
  PERSISTED_FOLLOWER_KEY_SYMBOL,
  PERSISTED_FOLLOWER_PERSIST_NAME,
  scanSelectionWriters,
} from '../check-selection-writer-retirement.mjs';

test('the key anchor names the exact matter-store persist sink', () => {
  assert.equal(PERSISTED_FOLLOWER_KEY_SYMBOL, 'SK_MATTERS');
  assert.equal(PERSISTED_FOLLOWER_PERSIST_NAME, 'lantern:matters');
});

test('the required tree has one follower projection writer and no legacy client writer', () => {
  const result = auditSelectionWriters(process.cwd());
  assert.deepEqual(result.forbidden, []);
  assert.equal(
    result.allowed.filter((entry) =>
      entry.includes('single source-owned follower projection')
    ).length,
    1
  );
});

test('the proof fails direct activeMatterId property assignments', () => {
  const result = scanSelectionWriters(
    'scripts/demo/Forbidden.mjs',
    `
      state.activeMatterId = null;
      state['activeMatterId'] ||= saved;
    `
  );
  assert.equal(result.forbidden.length, 2);
  assert.match(result.forbidden[0], /direct activeMatterId property assignment/);
  assert.match(result.forbidden[1], /direct activeMatterId property assignment/);
});

test('the proof rejects an unlisted script touching the persisted key through an unknown API', () => {
  const result = scanSelectionWriters(
    'scripts/demo/unlisted-seed.mjs',
    `mysteryPersistenceApi('lantern:matters', opaquePayload);`
  );
  assert.equal(result.forbidden.length, 1);
  assert.match(result.forbidden[0], /unreviewed persisted follower key lantern:matters/);
});

test('the executable audit rejects an unlisted persisted-key script', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-key-anchor-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/platform/client-context'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts/demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src/platform/client-context/clientContextStore.ts'),
    `useMatterStore.getState().setActiveMatter(projection);`
  );
  fs.writeFileSync(
    path.join(root, 'scripts/demo/unlisted-seed.mjs'),
    `mysteryPersistenceApi('lantern:matters', opaquePayload);`
  );

  const result = auditSelectionWriters(root);
  assert.equal(result.forbidden.length, 1);
  assert.match(
    result.forbidden[0],
    /^scripts\/demo\/unlisted-seed\.mjs:1 unreviewed persisted follower key lantern:matters/
  );
});

test('the key anchor rejects runtime storage smuggling regardless of API shape', () => {
  const result = scanSelectionWriters(
    'src/features/example/Forbidden.ts',
    `unknownFilesystemBridge.write('lantern:matters', serializedFollowerState);`
  );
  assert.equal(result.forbidden.length, 1);
  assert.match(result.forbidden[0], /unreviewed persisted follower key lantern:matters/);
});

test('the named seed scripts are accounted as reclassified hints, never authority', () => {
  const result = auditSelectionWriters(process.cwd());
  for (const relativePath of [
    'scripts/demo/legion-reset.mjs',
    'scripts/demo/legion-seed.mjs',
    'scripts/demo/reset-loaded.mjs',
    'scripts/robot/verbs/reset.mjs',
  ]) {
    const entries = result.allowed.filter((entry) => entry.startsWith(`${relativePath}:`));
    assert.ok(entries.length > 0, `${relativePath} must be explicitly accounted`);
    assert.ok(
      entries.every((entry) => /hint, not authority; boot re-classifies it/.test(entry)),
      `${relativePath} must carry the hint-not-authority frame justification`
    );
  }
});

test('the executable audit includes scripts in the required tree', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-writer-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/platform/client-context'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts/demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src/platform/client-context/clientContextStore.ts'),
    `useMatterStore.getState().setActiveMatter(projection);`
  );
  fs.writeFileSync(
    path.join(root, 'scripts/demo/Forbidden.mjs'),
    `persisted.activeMatterId = null;`
  );

  const result = auditSelectionWriters(root);
  assert.equal(result.forbidden.length, 1);
  assert.match(result.forbidden[0], /^scripts\/demo\/Forbidden\.mjs:/);
});

test('the proof fails a newly introduced direct follower writer', () => {
  const result = scanSelectionWriters(
    'src/features/example/Forbidden.ts',
    `export function bad() { useMatterStore.getState().setActiveMatter('x'); }`
  );
  assert.equal(result.forbidden.length, 1);
  assert.match(result.forbidden[0], /direct setActiveMatter caller/);
});

test('the proof fails raw hydration and direct client writers', () => {
  const result = scanSelectionWriters(
    'src/features/example/Forbidden.ts',
    `
      useMatterStore.setState({ activeMatterId: saved });
      useClientContextStore.getState().setClient(client);
      useClientContextStore.getState().clearClient();
    `
  );
  assert.equal(result.forbidden.length, 3);
});

test('the proof fails an identifier-bound raw follower payload', () => {
  const result = scanSelectionWriters(
    'src/features/example/Forbidden.ts',
    `
      const next = { activeMatterId: saved };
      useMatterStore.setState(next);
    `
  );
  assert.equal(result.forbidden.length, 1);
  assert.match(result.forbidden[0], /unreviewed raw matter-store setState/);
});

test('the proof rejects bracket-syntax selection writers', () => {
  const result = scanSelectionWriters(
    'src/features/example/Forbidden.ts',
    `
      useMatterStore.getState()['setActiveMatter']('x');
      useClientContextStore.getState()['setClient'](client);
    `
  );
  assert.equal(result.forbidden.length, 2);
});

test('the proof fails destructured matter and client writer bindings', () => {
  const result = scanSelectionWriters(
    'src/features/example/Forbidden.ts',
    `
      const { setActiveMatter: chooseMatter } = useMatterStore.getState();
      const { setClient, clearClient: clear } = useClientContextStore.getState();
      chooseMatter('x');
      setClient(client);
      clear();
    `
  );
  assert.equal(result.forbidden.length, 3);
  assert.match(result.forbidden[0], /destructured legacy writer setActiveMatter/);
  assert.match(result.forbidden[1], /destructured legacy client writer setClient/);
  assert.match(result.forbidden[2], /destructured legacy client writer clearClient/);
});

test('the executable audit itself enforces exactly one projection writer', () => {
  const result = auditSelectionWriters(process.cwd());
  assert.equal(
    result.allowed.filter((entry) =>
      entry.includes('single source-owned follower projection')
    ).length,
    1
  );
  assert.doesNotMatch(result.forbidden.join('\n'), /projection writer count/);
});
