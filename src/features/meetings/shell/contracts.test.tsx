import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMeetingArtifactComposition,
  getMeetingListComposition,
  getMeetingListToolComposition,
  getNoticeEvidenceProviderComposition,
  registerMeetingArtifactDescriptor,
  registerMeetingListDescriptor,
  registerMeetingListToolDescriptor,
  registerNoticeEvidenceProviderDescriptor,
  subscribeMeetingListRegistry,
} from './contracts';

const cleanups: Array<() => void> = [];
const track = (cleanup: () => void) => {
  cleanups.push(cleanup);
  return cleanup;
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('Meetings shell live registries', () => {
  it('orders a live outside list view, notifies on add and cleanup, and excludes unavailable entries', () => {
    const listener = vi.fn();
    const unsubscribe = track(subscribeMeetingListRegistry(listener));
    const removeVisible = track(
      registerMeetingListDescriptor({
        id: 'contract-visible',
        kind: 'primary',
        order: 25,
        labelKey: 'contract.visible',
        render: () => createElement('output'),
      })
    );
    const removeDark = track(
      registerMeetingListDescriptor({
        id: 'contract-dark',
        kind: 'primary',
        order: 26,
        labelKey: 'contract.dark',
        isAvailable: () => false,
        render: () => createElement('output'),
      })
    );

    const ids = getMeetingListComposition().map(({ id }) => id);
    expect(ids).toContain('contract-visible');
    expect(ids).not.toContain('contract-dark');
    expect(ids.indexOf('past')).toBeLessThan(ids.indexOf('contract-visible'));
    expect(ids.indexOf('contract-visible')).toBeLessThan(ids.indexOf('actions'));
    expect(listener).toHaveBeenCalledTimes(2);

    removeDark();
    cleanups.splice(cleanups.indexOf(removeDark), 1);
    removeVisible();
    cleanups.splice(cleanups.indexOf(removeVisible), 1);
    expect(getMeetingListComposition().map(({ id }) => id)).not.toContain(
      'contract-visible'
    );
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    cleanups.splice(cleanups.indexOf(unsubscribe), 1);
  });

  it('rejects duplicate and malformed list descriptors before changing the host', () => {
    const remove = track(
      registerMeetingListDescriptor({
        id: 'contract-duplicate',
        kind: 'primary',
        order: 25,
        labelKey: 'contract.duplicate',
        render: () => null,
      })
    );
    expect(() =>
      registerMeetingListDescriptor({
        id: 'contract-duplicate',
        kind: 'primary',
        order: 26,
        labelKey: 'contract.duplicate-two',
        render: () => null,
      })
    ).toThrow('duplicate or missing id');
    expect(() =>
      registerMeetingListDescriptor({
        id: 'contract-malformed',
        kind: 'primary',
        order: Number.NaN,
        labelKey: 'not-namespaced',
        render: () => null,
      })
    ).toThrow('order must be finite');
    expect(getMeetingListComposition().map(({ id }) => id)).toContain(
      'contract-duplicate'
    );
    remove();
    cleanups.splice(cleanups.indexOf(remove), 1);
  });

  it('accepts one public contribution in each narrow host composition', () => {
    track(
      registerMeetingListToolDescriptor({
        id: 'contract-tool',
        order: 20,
        labelKey: 'contract.tool',
        render: () => null,
      })
    );
    track(
      registerMeetingArtifactDescriptor({
        id: 'contract-artifact',
        order: 10,
        labelKey: 'contract.artifact',
        render: () => null,
      })
    );
    track(
      registerNoticeEvidenceProviderDescriptor({
        id: 'contract-notice',
        order: 10,
        labelKey: 'contract.notice',
        render: () => null,
      })
    );

    expect(
      getMeetingListToolComposition().map(({ id }) => id)
    ).toContain('contract-tool');
    expect(
      getMeetingArtifactComposition().map(({ id }) => id)
    ).toContain('contract-artifact');
    expect(
      getNoticeEvidenceProviderComposition().map(({ id }) => id)
    ).toContain('contract-notice');
    expect(getMeetingListComposition().map(({ id }) => id)).toContain(
      'upcoming'
    );
  });
});
