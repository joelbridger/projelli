// QA-60 — case-only filename collisions must never ship.
//
// Background: `meetingNoteOutboundGate.ts` (logic) and
// `MeetingNoteOutboundGate.tsx` (component) differed only by the first
// letter's case. Linux/CI's case-sensitive filesystem resolves both fine,
// but Windows/macOS default to case-insensitive filesystems, where an
// extensionless import (`./meetingNoteOutboundGate`) can resolve to either
// file depending on directory-listing order — live-verified on two separate
// Windows machines to silently serve the wrong file's exports and crash the
// whole React mount (permanent blank white screen), with zero signal on
// Linux/CI. This test reuses the exact scan from
// scripts/check-case-collisions.mjs so the invariant is enforced inside
// `vitest run`, not only in scripts/gate.sh — one source of truth.
import { describe, it, expect } from 'vitest';
import { findCaseCollisions } from '../../scripts/check-case-collisions.mjs';

describe('case-only filename collisions (QA-60)', () => {
  it('has zero case-only collisions across git-tracked files', () => {
    const { exact, stems } = findCaseCollisions();
    expect(
      exact,
      exact.length
        ? 'Files identical except for case (breaks git checkout on a ' +
            'case-insensitive filesystem):\n' +
            exact.map((e) => `  ${e.files.join(' <-> ')}`).join('\n')
        : '',
    ).toEqual([]);
    expect(
      stems,
      stems.length
        ? 'Files identical except for case once the extension is stripped ' +
            "(an extensionless import can't tell them apart on Windows):\n" +
            stems.map((s) => `  ${s.files.join(' <-> ')}`).join('\n')
        : '',
    ).toEqual([]);
  });
});
