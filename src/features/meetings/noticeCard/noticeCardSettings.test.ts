import { describe, it, expect } from 'vitest';
import {
  resolveNoticeCardEnabled,
  resolveNoticeCardNameTemplate,
  resolveNoticeEvidenceRule,
} from './noticeCardSettings';

/** A getter over a plain settings map. */
const get = (map: Record<string, unknown>) => (key: string) => map[key];

describe('resolveNoticeCardEnabled', () => {
  it('defaults to true when unset', () => {
    expect(resolveNoticeCardEnabled(get({}))).toBe(true);
  });
  it('honors an explicit false', () => {
    expect(resolveNoticeCardEnabled(get({ 'meetings.noticeCardEnabled': false }))).toBe(false);
  });
});

describe('resolveNoticeCardNameTemplate', () => {
  it('defaults to the honest recording-notice template', () => {
    expect(resolveNoticeCardNameTemplate(get({}))).toContain('{product}');
    expect(resolveNoticeCardNameTemplate(get({}))).toContain('Recording');
  });
  it('returns a firm override', () => {
    expect(resolveNoticeCardNameTemplate(get({ 'meetings.noticeCardNameTemplate': 'Rec — {advisor}' }))).toBe(
      'Rec — {advisor}',
    );
  });
  it('falls back to the default for a blank override', () => {
    expect(resolveNoticeCardNameTemplate(get({ 'meetings.noticeCardNameTemplate': '   ' }))).toContain('{product}');
  });
});

describe('resolveNoticeEvidenceRule', () => {
  it('defaults to either', () => {
    expect(resolveNoticeEvidenceRule(get({}))).toBe('either');
  });
  it('honors both', () => {
    expect(resolveNoticeEvidenceRule(get({ 'meetings.noticeEvidenceRule': 'both' }))).toBe('both');
  });
  it('falls back to either for anything unrecognized (never fails into a stricter surprise)', () => {
    expect(resolveNoticeEvidenceRule(get({ 'meetings.noticeEvidenceRule': 'nonsense' }))).toBe('either');
  });
});
