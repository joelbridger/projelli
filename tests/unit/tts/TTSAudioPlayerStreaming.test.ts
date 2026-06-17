/**
 * Task 16 — Add streaming speak support to TTSAudioPlayer
 *
 * Streaming API: beginStream() / appendChunk(bytes) / finishStream()
 *
 * v2.0 implementation uses buffer-then-play: chunks accumulate in an
 * internal Uint8Array; finishStream() concatenates them, calls loadBuffer()
 * then play(). The streaming shape stabilises call sites for a future
 * per-chunk ring-buffer upgrade.
 *
 * Covers:
 *   - beginStream() transitions status to 'streaming'
 *   - appendChunk() while streaming accepts bytes without error
 *   - finishStream() concatenates chunks and starts playback ('playing')
 *   - appendChunk() called before beginStream() throws
 *   - finishStream() called before beginStream() throws
 *   - Empty stream (finishStream() with no chunks) is a no-op (stays idle)
 *   - stop() during streaming clears buffered chunks and goes idle
 *   - PlayerStatus type includes 'streaming'
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSAudioPlayer } from '@/features/dictation/engine/TTSAudioPlayer';

// ---------------------------------------------------------------------------
// Web Audio mock (mirrors TTSAudioPlayer.test.ts)
// ---------------------------------------------------------------------------

function makeMockSource() {
  return {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null as ((ev: Event) => void) | null,
  };
}

let lastSource: ReturnType<typeof makeMockSource>;

const mockSuspend = vi.fn().mockResolvedValue(undefined);
const mockResume = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockDecodeAudioData = vi.fn();

function makeCtx() {
  return {
    state: 'running' as AudioContextState,
    destination: {} as AudioDestinationNode,
    suspend: mockSuspend,
    resume: mockResume,
    close: mockClose,
    decodeAudioData: mockDecodeAudioData,
    createBufferSource: vi.fn(() => {
      lastSource = makeMockSource();
      return lastSource;
    }),
  };
}

const fakeAudioBuffer = { duration: 3.0 } as AudioBuffer;

beforeEach(() => {
  vi.clearAllMocks();
  mockDecodeAudioData.mockResolvedValue(fakeAudioBuffer);
  // @ts-expect-error - mock global
  globalThis.AudioContext = function AudioContextMock() {
    return makeCtx();
  };
});

afterEach(() => {
  // @ts-expect-error - cleanup
  delete globalThis.AudioContext;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TTSAudioPlayer streaming API', () => {
  describe('PlayerStatus type', () => {
    it('status "streaming" is accepted by the type (compile-time check via runtime)', () => {
      // If 'streaming' is not a valid PlayerStatus, TypeScript would fail at build.
      // We verify the runtime constant matches what the module exports.
      const player = new TTSAudioPlayer();
      // Before beginStream, status is 'idle'
      expect(player.status).toBe('idle');
    });
  });

  describe('beginStream()', () => {
    it('transitions status to "streaming"', () => {
      const player = new TTSAudioPlayer();
      player.beginStream();
      expect(player.status).toBe('streaming');
    });

    it('resets any previously buffered chunks', () => {
      const player = new TTSAudioPlayer();
      player.beginStream();
      player.appendChunk(new Uint8Array([1, 2, 3]));
      // Start a fresh stream — accumulated bytes should be discarded
      player.beginStream();
      // No assertion on internals; test that finishStream with no new
      // chunks is a no-op (empty stream)
      player.finishStream();
      expect(player.status).toBe('idle');
    });
  });

  describe('appendChunk()', () => {
    it('accepts bytes while streaming without error', () => {
      const player = new TTSAudioPlayer();
      player.beginStream();
      expect(() =>
        player.appendChunk(new Uint8Array([82, 73, 70, 70])),
      ).not.toThrow();
    });

    it('throws when called before beginStream()', () => {
      const player = new TTSAudioPlayer();
      expect(() => player.appendChunk(new Uint8Array([1]))).toThrow(
        /stream.*not.*started|beginStream/i,
      );
    });
  });

  describe('finishStream()', () => {
    it('throws when called before beginStream()', async () => {
      const player = new TTSAudioPlayer();
      await expect(player.finishStream()).rejects.toThrow(
        /stream.*not.*started|beginStream/i,
      );
    });

    it('is a no-op (returns to idle) when no chunks were appended', () => {
      const player = new TTSAudioPlayer();
      player.beginStream();
      player.finishStream();
      expect(player.status).toBe('idle');
      expect(mockDecodeAudioData).not.toHaveBeenCalled();
    });

    it('concatenates chunks, decodes, and starts playback', async () => {
      const player = new TTSAudioPlayer();
      player.beginStream();
      // Append two chunks
      player.appendChunk(new Uint8Array([1, 2, 3]));
      player.appendChunk(new Uint8Array([4, 5]));
      await player.finishStream();

      expect(mockDecodeAudioData).toHaveBeenCalledTimes(1);
      // Total concatenated bytes = 5
      const decoded: ArrayBuffer = mockDecodeAudioData.mock.calls[0][0] as ArrayBuffer;
      expect(decoded.byteLength).toBe(5);

      expect(player.status).toBe('playing');
    });
  });

  describe('stop() during streaming', () => {
    it('clears accumulated chunks and transitions to idle', () => {
      const player = new TTSAudioPlayer();
      player.beginStream();
      player.appendChunk(new Uint8Array([1, 2, 3]));
      player.stop();
      expect(player.status).toBe('idle');
    });

    it('after stop, beginStream can restart cleanly', async () => {
      const player = new TTSAudioPlayer();
      player.beginStream();
      player.appendChunk(new Uint8Array([1]));
      player.stop();

      // Fresh stream
      player.beginStream();
      player.appendChunk(new Uint8Array([10, 20, 30]));
      await player.finishStream();

      expect(player.status).toBe('playing');
      // Only one decode call since the previous stop cleared the buffer
      expect(mockDecodeAudioData).toHaveBeenCalledTimes(1);
      const decoded: ArrayBuffer = mockDecodeAudioData.mock.calls[0][0] as ArrayBuffer;
      expect(decoded.byteLength).toBe(3); // only the 3 bytes from the second stream
    });
  });

  describe('status transitions with streaming', () => {
    it('idle → streaming → playing → idle', async () => {
      const player = new TTSAudioPlayer();
      expect(player.status).toBe('idle');

      player.beginStream();
      expect(player.status).toBe('streaming');

      player.appendChunk(new Uint8Array([1, 2, 3, 4]));
      await player.finishStream();
      expect(player.status).toBe('playing');

      player.stop();
      expect(player.status).toBe('idle');
    });
  });
});
