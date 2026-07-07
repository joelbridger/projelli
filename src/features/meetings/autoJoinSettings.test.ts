import { beforeEach, describe, expect, it } from 'vitest';
import {
  markAutoJoinOccurrenceStarted,
  markAutoJoinOccurrencesPresented,
  readPresentedAutoJoinOccurrenceKeys,
  readStartedAutoJoinOccurrenceKeys,
} from './autoJoinSettings';

describe('MF3 auto-join durable gates', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists presented occurrence keys so the scheduler can require a shown meeting', () => {
    markAutoJoinOccurrencesPresented(['outlook:event-1:2026-07-07T16:00:00Z']);

    expect(readPresentedAutoJoinOccurrenceKeys()).toEqual(
      new Set(['outlook:event-1:2026-07-07T16:00:00Z']),
    );
  });

  it('persists started occurrence keys across an app restart', () => {
    markAutoJoinOccurrenceStarted('outlook:event-1:2026-07-07T16:00:00Z');

    expect(readStartedAutoJoinOccurrenceKeys()).toEqual(
      new Set(['outlook:event-1:2026-07-07T16:00:00Z']),
    );
  });
});
