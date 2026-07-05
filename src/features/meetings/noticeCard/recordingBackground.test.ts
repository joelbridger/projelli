import { describe, it, expect, vi } from 'vitest';
import { drawRecordingBackground } from './recordingBackground';

function fakeCtx() {
  const texts: string[] = [];
  return {
    texts,
    fillStyle: '',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    fillRect: vi.fn(),
    fillText: vi.fn((t: string) => texts.push(t)),
  };
}

describe('drawRecordingBackground', () => {
  it('paints a background band and the recording label with the dot', () => {
    const ctx = fakeCtx();
    drawRecordingBackground(ctx as unknown as CanvasRenderingContext2D, 1920, 1080, 'RECORDING in progress');
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.texts.join(' ')).toContain('RECORDING in progress');
    expect(ctx.texts.join(' ')).toContain('⏺');
  });
});
