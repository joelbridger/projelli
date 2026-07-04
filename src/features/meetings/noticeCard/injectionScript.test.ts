import { describe, it, expect } from 'vitest';
import { buildInjectionScript, NOTICE_CARD_TITLE_PREFIX } from './injectionScript';
import type { NoticeCardConfig } from './noticeCardTypes';

const cfg = (over: Partial<NoticeCardConfig> = {}): NoticeCardConfig => ({
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  platform: 'teams',
  displayName: '⏺ Recording Notice — Sarah',
  meetingDir: 'Meetings/2026-07-04-henderson',
  meetingTitle: 'Henderson quarterly review',
  ...over,
});

describe('buildInjectionScript', () => {
  it('produces a syntactically valid, self-contained IIFE', () => {
    const src = buildInjectionScript(cfg());
    expect(src.trimStart().startsWith('(function')).toBe(true);
    // Compiles without throwing (validates the serialized adapter methods too).
    expect(() => new Function(src)).not.toThrow();
  });

  it('embeds the display name and the selected adapter source', () => {
    const src = buildInjectionScript(cfg());
    expect(src).toContain(JSON.stringify('⏺ Recording Notice — Sarah'));
    expect(src).toContain('detectPhase('); // Teams adapter method serialized in
  });

  it('reports state through the document.title channel (no IPC bridge)', () => {
    const src = buildInjectionScript(cfg());
    expect(src).toContain(NOTICE_CARD_TITLE_PREFIX);
    // The page is never handed a Tauri/IPC handle by us.
    expect(src).not.toContain('__TAURI__');
    expect(src).not.toContain('invoke(');
  });

  it('re-asserts the status title when the meeting page overwrites document.title', () => {
    // Guards against Teams/Zoom rewriting document.title and the poller missing
    // the only NC:admitted/NC:lobby signal (Codex R3 P1).
    const src = buildInjectionScript(cfg());
    expect(src).toContain('document.title === desired');
  });

  it('selects the Zoom adapter for a Zoom config', () => {
    const src = buildInjectionScript(cfg({ platform: 'zoom', joinUrl: 'https://zoom.us/j/1' }));
    expect(() => new Function(src)).not.toThrow();
    // Zoom's name selector is distinctive.
    expect(src).toContain('#input-for-name');
  });

  it('prepends a camera install script when provided (v2 canvas camera)', () => {
    const src = buildInjectionScript(cfg(), { cameraScript: '/*CAMERA_MARKER*/' });
    expect(src).toContain('/*CAMERA_MARKER*/');
    expect(() => new Function(src)).not.toThrow();
  });

  it('throws for a platform with no adapter (defensive; supervisor guards too)', () => {
    expect(() => buildInjectionScript(cfg({ platform: 'meet', joinUrl: 'https://meet.google.com/x' }))).toThrow();
    expect(() => buildInjectionScript(cfg({ platform: 'none', joinUrl: '' }))).toThrow();
  });
});
