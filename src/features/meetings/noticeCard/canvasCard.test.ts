import { describe, it, expect, vi } from 'vitest';
import { formatRecordingTimer, drawNoticeCard, buildCameraScript, type NoticeCardVisual } from './canvasCard';

describe('formatRecordingTimer', () => {
  it('formats under an hour as M:SS', () => {
    expect(formatRecordingTimer(0)).toBe('0:00');
    expect(formatRecordingTimer(9000)).toBe('0:09');
    expect(formatRecordingTimer(65_000)).toBe('1:05');
    expect(formatRecordingTimer(59_000)).toBe('0:59');
  });
  it('formats an hour or more as H:MM:SS', () => {
    expect(formatRecordingTimer(3_600_000)).toBe('1:00:00');
    expect(formatRecordingTimer(3_661_000)).toBe('1:01:01');
  });
  it('never goes negative (clock skew guard)', () => {
    expect(formatRecordingTimer(-5000)).toBe('0:00');
  });
});

/** A fake 2D context that records the text it draws + settable style props. */
function fakeCtx() {
  const texts: string[] = [];
  const rects: Array<[number, number, number, number]> = [];
  return {
    texts,
    rects,
    fillStyle: '',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => rects.push([x, y, w, h])),
    fillText: vi.fn((t: string) => texts.push(t)),
    measureText: vi.fn(() => ({ width: 100 }) as TextMetrics),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
  };
}

const VISUAL: NoticeCardVisual = {
  title: 'This meeting is being recorded by Sarah Morgan',
  lines: ['The recording stays on her computer', 'Nothing is uploaded', 'Questions welcome'],
  footer: 'This card leaves when recording ends',
  recordingLabel: 'Recording',
};

describe('drawNoticeCard', () => {
  it('paints a background and renders every line of notice copy + the timer', () => {
    const ctx = fakeCtx();
    drawNoticeCard(ctx as unknown as CanvasRenderingContext2D, 1280, 720, { ...VISUAL, timerText: '2:34' });
    // Background fill happened.
    expect(ctx.fillRect).toHaveBeenCalled();
    // Title, each body line, footer, and the "Recording · 2:34" all drawn.
    const all = ctx.texts.join(' | ');
    expect(all).toContain(VISUAL.title);
    for (const line of VISUAL.lines) expect(all).toContain(line);
    expect(all).toContain(VISUAL.footer);
    expect(all).toContain('2:34');
    expect(all).toContain('Recording');
  });
});

describe('buildCameraScript', () => {
  it('produces a syntactically valid IIFE that installs a getUserMedia shim', () => {
    const src = buildCameraScript(VISUAL, { startEpochMs: 1_000_000 });
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('getUserMedia');
    expect(src).toContain('captureStream');
  });
  it('embeds the localized card copy safely (JSON-encoded, no raw interpolation)', () => {
    const src = buildCameraScript(VISUAL, { startEpochMs: 1_000_000 });
    expect(src).toContain(JSON.stringify(VISUAL.title));
    expect(src).toContain(JSON.stringify(VISUAL.footer));
    // The serialized pure helpers are present.
    expect(src).toContain('drawNoticeCard');
    expect(src).toContain('formatRecordingTimer');
  });

  it('never passes through to the real camera/microphone (records nothing, sends nothing)', () => {
    // Codex R4 P1: an audio-only getUserMedia must NOT reach the real device.
    const src = buildCameraScript(VISUAL, { startEpochMs: 1_000_000 });
    // No captured reference to the original getUserMedia, and no passthrough.
    expect(src).not.toContain('.bind(md)');
    expect(src).not.toContain('return real(');
    // Audio requests are answered with a locally-generated silent track.
    expect(src).toContain('createMediaStreamDestination');
  });

  it('installs the getUserMedia override even when canvas capture is unavailable (Codex R6 P1)', () => {
    // The override must NOT be gated on cardStream — otherwise a WebView without
    // canvas.captureStream would let the page reach the real camera/mic.
    const src = buildCameraScript(VISUAL, { startEpochMs: 1_000_000 });
    expect(src).toContain('if (md && md.getUserMedia) {');
    expect(src).not.toContain('md.getUserMedia && cardStream');
    // The card video is only added when cardStream exists, but the override is
    // always installed, so real devices are never handed over.
    expect(src).toContain('constraints.video && cardStream');
  });
});
