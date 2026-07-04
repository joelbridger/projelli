import { describe, it, expect } from 'vitest';
import { resolveNoticePolicy, customNoticeScript, type NoticePolicy } from './noticeSettings';

function getter(map: Record<string, unknown>) {
  return (k: string): unknown => map[k];
}

describe('resolveNoticePolicy', () => {
  it('defaults to standard when unset or unknown', () => {
    expect(resolveNoticePolicy(getter({}))).toBe('standard');
    expect(resolveNoticePolicy(getter({ 'meetings.noticePolicy': 'nonsense' }))).toBe('standard');
  });
  it('reads standard/strict', () => {
    expect(resolveNoticePolicy(getter({ 'meetings.noticePolicy': 'standard' }))).toBe<NoticePolicy>('standard');
    expect(resolveNoticePolicy(getter({ 'meetings.noticePolicy': 'strict' }))).toBe<NoticePolicy>('strict');
  });
});

describe('customNoticeScript', () => {
  it('returns empty string when unset or blank (use the localized default)', () => {
    expect(customNoticeScript(getter({}))).toBe('');
    expect(customNoticeScript(getter({ 'meetings.noticeScript': '   ' }))).toBe('');
  });
  it('trims and returns a custom script', () => {
    expect(customNoticeScript(getter({ 'meetings.noticeScript': '  Recording for notes.  ' }))).toBe('Recording for notes.');
  });
});
