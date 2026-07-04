import { describe, it, expect } from 'vitest';
import { resolveTarget, listTargets, TARGETS, DEFAULT_TARGET_ID } from '../targets.mjs';

describe('resolveTarget', () => {
  it('resolves a known target by id', () => {
    const t = resolveTarget('legion');
    expect(t.sshUser).toBe('james');
    expect(t.sshHost).toBe('100.127.67.22');
    expect(t.repoDir).toBe('C:\\lantern-plus');
  });

  it('defaults to legion when no id is given', () => {
    expect(resolveTarget(undefined).id).toBe(DEFAULT_TARGET_ID);
  });

  it('resolves the azure cloud bench', () => {
    const t = resolveTarget('azure-cloud-bench-1');
    expect(t.sshUser).toBe('lpbench');
    expect(t.sshHost).toBe('100.75.247.98');
  });

  it('gives each registered target its own scheduled-task name', () => {
    expect(resolveTarget('legion').taskName).toBe('LanternPlusDev');
    expect(resolveTarget('azure-cloud-bench-1').taskName).toBe('LanternDevBench');
  });

  it('falls back to the default task name for an ad hoc target', () => {
    const t = resolveTarget('scratch-vm', { host: '10.0.0.9', user: 'bob' });
    expect(t.taskName).toBe('LanternPlusDev');
  });

  it('allows a taskName override', () => {
    const t = resolveTarget('legion', { taskName: 'CustomTask' });
    expect(t.taskName).toBe('CustomTask');
  });

  it('applies host/user/repoDir overrides onto a known target', () => {
    const t = resolveTarget('legion', { host: '10.0.0.5', user: 'someone', repoDir: 'C:\\other' });
    expect(t.sshHost).toBe('10.0.0.5');
    expect(t.sshUser).toBe('someone');
    expect(t.repoDir).toBe('C:\\other');
  });

  it('throws for an unknown id with no overrides', () => {
    expect(() => resolveTarget('nope')).toThrow(/Unknown bench target/);
  });

  it('builds an ad hoc target when an unknown id has host+user overrides', () => {
    const t = resolveTarget('scratch-vm', { host: '10.0.0.9', user: 'bob' });
    expect(t.sshHost).toBe('10.0.0.9');
    expect(t.sshUser).toBe('bob');
    expect(t.repoDir).toBe('C:\\lantern-plus');
  });

  it('listTargets returns every registered target', () => {
    const all = listTargets();
    expect(all.length).toBe(Object.keys(TARGETS).length);
    expect(all.map((t) => t.id)).toEqual(expect.arrayContaining(['legion', 'azure-cloud-bench-1']));
  });
});
