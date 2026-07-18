import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditSelectionWriters,
  scanSelectionWriters,
} from '../check-selection-writer-retirement.mjs';

test('the production tree has one follower projection writer and no legacy client writer', () => {
  const result = auditSelectionWriters(process.cwd());
  assert.deepEqual(result.forbidden, []);
  assert.equal(
    result.allowed.filter((entry) =>
      entry.includes('single source-owned follower projection')
    ).length,
    1
  );
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
