import { describe, expect, it } from 'vitest';
import { meetingFoundationDependentManifest } from './manifest';

describe('meetings foundation dependent manifest', () => {
  it('names a unique fixture for every ready consumer and an explicit coordinator stop for every blocked owner seam', () => {
    const ready = meetingFoundationDependentManifest.filter(
      (entry) => entry.status === 'ready'
    );
    const blocked = meetingFoundationDependentManifest.filter(
      (entry) => entry.status === 'coordinator-blocked'
    );
    expect(new Set(ready.map((entry) => entry.fixture)).size).toBe(
      ready.length
    );
    expect(ready.every((entry) => entry.fixture?.endsWith('.import.ts'))).toBe(
      true
    );
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((entry) => entry.fixture === null)).toBe(true);
    expect(
      blocked.every((entry) => entry.reason?.startsWith('COORDINATOR:'))
    ).toBe(true);
  });
});
