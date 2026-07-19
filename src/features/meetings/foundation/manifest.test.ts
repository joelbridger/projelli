import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { meetingFoundationDependentManifest } from './manifest';

const fixturesDir = resolve(import.meta.dirname, '..', 'fixtures');

// The exact Part A consumer set. This is a closed check: a dropped or renamed
// consumer fails here, so the manifest cannot silently narrow the dispatch map.
const EXPECTED_CONSUMERS = [
  'meetings-core-records',
  'notice-evidence-read-model',
  'ask-across-meetings',
  'meetings-shell-v1',
  'meeting-spoken-notice',
  'meeting-diarization',
  'meeting-notice-evidence',
  'meeting-keywords',
  'meeting-talk-time',
  'meeting-signals',
  'meeting-intelligence-settings',
  'meeting-visibility-inheritance',
  'my-meetings-filter',
  'crm-client-meetings-tab',
  'crm-client-meeting-prep-tab',
  'meeting-panel-registry',
  'meeting-header-action-registry',
  'meeting-insight-registry',
  'meeting-list-registry',
  'meeting-list-tool-registry',
  'meeting-artifact-registry',
  'notice-evidence-provider-registry',
];

describe('meetings foundation dependent manifest', () => {
  it('covers the exact consumer set with no duplicates', () => {
    const consumers = meetingFoundationDependentManifest.map(
      (entry) => entry.consumer
    );
    expect(new Set(consumers).size).toBe(consumers.length);
    expect([...consumers].sort()).toEqual([...EXPECTED_CONSUMERS].sort());
  });

  it('points every ready consumer at an import fixture that actually exists', () => {
    const ready = meetingFoundationDependentManifest.filter(
      (entry) => entry.status === 'ready'
    );
    expect(ready.length).toBeGreaterThan(0);
    for (const entry of ready) {
      expect(entry.fixture, entry.consumer).toMatch(/\.import\.ts$/);
      expect(
        existsSync(resolve(fixturesDir, entry.fixture ?? '')),
        `${entry.consumer} -> ${entry.fixture ?? '(none)'}`
      ).toBe(true);
    }
  });

  it('gives every blocked consumer a null fixture and an explicit coordinator stop', () => {
    const blocked = meetingFoundationDependentManifest.filter(
      (entry) => entry.status === 'coordinator-blocked'
    );
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((entry) => entry.fixture === null)).toBe(true);
    expect(
      blocked.every((entry) => entry.reason?.startsWith('COORDINATOR:'))
    ).toBe(true);
  });

  it('marks real flag-gated production doorways as integrated but dark', () => {
    const integratedDark = meetingFoundationDependentManifest.filter(
      (entry) => entry.status === 'integrated-dark'
    );
    expect(integratedDark.map((entry) => entry.consumer).sort()).toEqual([
      'meeting-intelligence-settings',
      'meeting-keywords',
      'meeting-list-registry',
      'meeting-list-tool-registry',
      'meetings-shell-v1',
      'my-meetings-filter',
    ]);
    expect(integratedDark.every((entry) => entry.fixture === null)).toBe(true);
    expect(
      integratedDark.every((entry) =>
        entry.reason?.startsWith('DARK-BUT-INTEGRATED:')
      )
    ).toBe(true);
  });
});
