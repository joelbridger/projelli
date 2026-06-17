/**
 * Task 8 — TTSAudioPlayer
 *
 * Covers:
 *   - loadBuffer(wav) decodes WAV bytes and stores AudioBuffer
 *   - play() starts playback from decoded buffer
 *   - pause() suspends AudioContext
 *   - stop() terminates source node
 *   - isPlaying() reflects playback state accurately
 *   - onEnded callback fires when playback finishes
 *   - dispose() cleans up AudioContext
 *   - Status transitions: idle → playing → paused → playing → ended
 *
 * AudioContext is fully mocked (jsdom has no Web Audio implementation).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSAudioPlayer } from '@/features/dictation/engine/TTSAudioPlayer';

// ---------------------------------------------------------------------------
// Web Audio mock helpers
// ---------------------------------------------------------------------------

/** Factory to create a fresh mock source node each test. */
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

// Track the most recently created source node so tests can trigger onended.
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

// Fake AudioBuffer returned by decodeAudioData
const fakeAudioBuffer = { duration: 2.5 } as AudioBuffer;

beforeEach(() => {
  vi.clearAllMocks();
  mockDecodeAudioData.mockResolvedValue(fakeAudioBuffer);
  // AudioContext must be a constructor (new-able class).
  // Arrow functions cannot be used with `new`; use a regular function mock.
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

describe('TTSAudioPlayer', () => {
  describe('initial state', () => {
    it('isPlaying() returns false before any playback', () => {
      const player = new TTSAudioPlayer();
      expect(player.isPlaying()).toBe(false);
    });

    it('status is "idle" initially', () => {
      const player = new TTSAudioPlayer();
      expect(player.status).toBe('idle');
    });
  });

  describe('loadBuffer()', () => {
    it('decodes WAV bytes via AudioContext.decodeAudioData', async () => {
      const player = new TTSAudioPlayer();
      const wav = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]); // RIFF
      await player.loadBuffer(wav);
      expect(mockDecodeAudioData).toHaveBeenCalledTimes(1);
    });

    it('stores the decoded buffer (duration accessible)', async () => {
      const player = new TTSAudioPlayer();
      const wav = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
      await player.loadBuffer(wav);
      expect(player.duration).toBe(2.5);
    });
  });

  describe('play()', () => {
    it('starts playback after loadBuffer and transitions to "playing"', async () => {
      const player = new TTSAudioPlayer();
      await player.loadBuffer(new Uint8Array(8));
      player.play();
      expect(player.status).toBe('playing');
      expect(player.isPlaying()).toBe(true);
    });

    it('throws if called before loadBuffer', () => {
      const player = new TTSAudioPlayer();
      expect(() => player.play()).toThrow(/no audio buffer/i);
    });

    it('calls createBufferSource and start on the source node', async () => {
      const player = new TTSAudioPlayer();
      await player.loadBuffer(new Uint8Array(8));
      player.play();
      expect(lastSource.start).toHaveBeenCalled();
    });
  });

  describe('pause()', () => {
    it('suspends AudioContext and transitions to "paused"', async () => {
      const player = new TTSAudioPlayer();
      await player.loadBuffer(new Uint8Array(8));
      player.play();
      await player.pause();
      expect(player.status).toBe('paused');
      expect(player.isPlaying()).toBe(false);
      expect(mockSuspend).toHaveBeenCalled();
    });

    it('is a no-op when not playing', async () => {
      const player = new TTSAudioPlayer();
      await expect(player.pause()).resolves.toBeUndefined();
      expect(player.status).toBe('idle');
    });
  });

  describe('stop()', () => {
    it('transitions to "idle" from "playing"', async () => {
      const player = new TTSAudioPlayer();
      await player.loadBuffer(new Uint8Array(8));
      player.play();
      player.stop();
      expect(player.status).toBe('idle');
      expect(player.isPlaying()).toBe(false);
    });

    it('is a no-op when already idle', () => {
      const player = new TTSAudioPlayer();
      expect(() => player.stop()).not.toThrow();
    });
  });

  describe('onEnded callback', () => {
    it('fires when the source node ends naturally', async () => {
      const onEnded = vi.fn();
      const player = new TTSAudioPlayer({ onEnded });
      await player.loadBuffer(new Uint8Array(8));
      player.play();

      // Simulate AudioBufferSourceNode.onended firing
      expect(lastSource.onended).toBeDefined();
      lastSource.onended!({} as Event);

      expect(onEnded).toHaveBeenCalledTimes(1);
      expect(player.status).toBe('idle');
    });
  });

  describe('dispose()', () => {
    it('closes AudioContext', async () => {
      const player = new TTSAudioPlayer();
      await player.loadBuffer(new Uint8Array(8));
      await player.dispose();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('transitions to "idle"', async () => {
      const player = new TTSAudioPlayer();
      await player.loadBuffer(new Uint8Array(8));
      player.play();
      await player.dispose();
      expect(player.status).toBe('idle');
    });
  });

  describe('status transitions', () => {
    it('idle → playing → paused → playing → idle', async () => {
      const player = new TTSAudioPlayer();
      expect(player.status).toBe('idle');
      await player.loadBuffer(new Uint8Array(8));
      player.play();
      expect(player.status).toBe('playing');
      await player.pause();
      expect(player.status).toBe('paused');
      player.play();
      expect(player.status).toBe('playing');
      player.stop();
      expect(player.status).toBe('idle');
    });
  });
});
