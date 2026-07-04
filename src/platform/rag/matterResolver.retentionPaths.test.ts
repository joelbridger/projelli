import { describe, it, expect } from 'vitest';
import { toWorkspaceRelativeFolder } from './matterResolver';

describe('toWorkspaceRelativeFolder — retention sweep path safety', () => {
  it('resolves a normal absolute matter folder under the workspace', () => {
    expect(toWorkspaceRelativeFolder('/ws/Clients/Acme', '/ws')).toBe('Clients/Acme');
  });

  it('returns empty for an absolute folder outside the workspace', () => {
    expect(toWorkspaceRelativeFolder('/etc/passwd', '/ws')).toBe('');
  });

  it('passes through an already-relative folder unchanged', () => {
    expect(toWorkspaceRelativeFolder('Clients/Acme', '/ws')).toBe('Clients/Acme');
  });

  it('refuses a relative folder that escapes above its assumed root via dot segments', () => {
    // Previously returned '../../etc/passwd' verbatim — this fed straight
    // into the Rust retention_sweep command as a "workspace-relative" folder.
    expect(toWorkspaceRelativeFolder('../../etc/passwd', '/ws')).toBe('');
  });

  it('refuses a bare ".." relative folder', () => {
    expect(toWorkspaceRelativeFolder('..', '/ws')).toBe('');
  });

  it('resolves a relative folder with a harmless internal dot-segment', () => {
    expect(toWorkspaceRelativeFolder('Clients/Acme/../Beta', '/ws')).toBe('Clients/Beta');
  });

  it('refuses an absolute dot-segment escape through the workspace root', () => {
    expect(toWorkspaceRelativeFolder('/ws/../etc', '/ws')).toBe('');
  });
});
