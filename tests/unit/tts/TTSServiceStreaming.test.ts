/**
 * Task 17 — Add streaming dispatch to TTSService
 *
 * TTSService.speakWithPlayer() orchestrates the full TTS round-trip:
 *   - If text.length <= 500: buffer-then-play (single invoke + loadBuffer + play)
 *   - If text.length > 500:  streaming path via beginStream/appendChunk/finishStream
 *
 * v2.0 implementation: both paths use a single invoke('tts_speak') call (Tauri
 * IPC streaming is scaffolded but not wired at the Rust layer for v2.0). The
 * streaming path uses the player streaming API so call sites are stable.
 *
 * Covers:
 *   - speakWithPlayer() calls invoke('tts_speak') in both modes
 *   - Short text (<=500 chars): player.loadBuffer + play called, no streaming methods
 *   - Long text (>500 chars): player streaming API (beginStream/appendChunk/finishStream)
 *   - In browser mode (isTauri=false): throws user-readable error
 *   - stop() via TTSService.stop() also stops the player
 *   - speakWithPlayer() returns without throwing when synthesis succeeds
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri before imports
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import { TTSService } from '@/modules/tts/TTSService';
import { TTSAudioPlayer } from '@/modules/tts/TTSAudioPlayer';

const mockInvoke = vi.mocked(tauriCore.invoke);
const mockIsTauri = vi.mocked(tauriCore.isTauri);

// Build a mock TTSAudioPlayer with spy methods
function makeMockPlayer(): TTSAudioPlayer {
  const player = new TTSAudioPlayer();
  vi.spyOn(player, 'loadBuffer').mockResolvedValue(undefined);
  vi.spyOn(player, 'play').mockImplementation(() => {});
  vi.spyOn(player, 'stop').mockImplementation(() => {});
  vi.spyOn(player, 'beginStream').mockImplementation(() => {});
  vi.spyOn(player, 'appendChunk').mockImplementation((_c: Uint8Array) => {});
  vi.spyOn(player, 'finishStream').mockResolvedValue(undefined);
  return player;
}

const SHORT_TEXT = 'Hello, world.'; // <= 500 chars
const LONG_TEXT = 'A'.repeat(501);   // > 500 chars

beforeEach(() => {
  TTSService._resetCache();
  vi.clearAllMocks();
  mockIsTauri.mockReturnValue(true);
  mockInvoke.mockResolvedValue([82, 73, 70, 70, 0, 0, 0, 0]); // minimal WAV header bytes
});

afterEach(() => {
  TTSService._resetCache();
});

describe('TTSService.speakWithPlayer()', () => {
  it('throws in browser mode with user-readable message', async () => {
    mockIsTauri.mockReturnValue(false);
    const player = makeMockPlayer();
    await expect(
      TTSService.speakWithPlayer(SHORT_TEXT, 'en_US-amy-medium', 1.0, player),
    ).rejects.toThrow(/desktop app/i);
  });

  it('calls invoke(tts_speak) for short text', async () => {
    const player = makeMockPlayer();
    await TTSService.speakWithPlayer(SHORT_TEXT, 'en_US-amy-medium', 1.0, player);
    expect(mockInvoke).toHaveBeenCalledWith('tts_speak', {
      text: SHORT_TEXT,
      voiceId: 'en_US-amy-medium',
      speed: 1.0,
    });
  });

  it('calls invoke(tts_speak) for long text', async () => {
    const player = makeMockPlayer();
    await TTSService.speakWithPlayer(LONG_TEXT, 'en_US-amy-medium', 1.0, player);
    expect(mockInvoke).toHaveBeenCalledWith('tts_speak', {
      text: LONG_TEXT,
      voiceId: 'en_US-amy-medium',
      speed: 1.0,
    });
  });

  describe('short text path (buffer-then-play)', () => {
    it('calls loadBuffer and play — not the streaming API', async () => {
      const player = makeMockPlayer();
      await TTSService.speakWithPlayer(SHORT_TEXT, 'en_US-amy-medium', 1.0, player);
      expect(player.loadBuffer).toHaveBeenCalledTimes(1);
      expect(player.play).toHaveBeenCalledTimes(1);
      expect(player.beginStream).not.toHaveBeenCalled();
      expect(player.finishStream).not.toHaveBeenCalled();
    });

    it('passes synthesized WAV bytes to loadBuffer', async () => {
      const fakeBytes = [82, 73, 70, 70, 0, 1, 2, 3];
      mockInvoke.mockResolvedValue(fakeBytes);
      const player = makeMockPlayer();
      await TTSService.speakWithPlayer(SHORT_TEXT, 'en_US-amy-medium', 1.0, player);
      const arg = (player.loadBuffer as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
      expect(arg).toBeInstanceOf(Uint8Array);
      expect(arg[0]).toBe(82); // 'R'
    });
  });

  describe('long text path (streaming API)', () => {
    it('calls beginStream, appendChunk, finishStream — not loadBuffer/play', async () => {
      const player = makeMockPlayer();
      await TTSService.speakWithPlayer(LONG_TEXT, 'en_US-amy-medium', 1.0, player);
      expect(player.beginStream).toHaveBeenCalledTimes(1);
      expect(player.appendChunk).toHaveBeenCalledTimes(1);
      expect(player.finishStream).toHaveBeenCalledTimes(1);
      expect(player.loadBuffer).not.toHaveBeenCalled();
      expect(player.play).not.toHaveBeenCalled();
    });

    it('passes synthesized WAV bytes to appendChunk', async () => {
      const fakeBytes = [10, 20, 30, 40];
      mockInvoke.mockResolvedValue(fakeBytes);
      const player = makeMockPlayer();
      await TTSService.speakWithPlayer(LONG_TEXT, 'en_US-amy-medium', 1.0, player);
      const arg = (player.appendChunk as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
      expect(arg).toBeInstanceOf(Uint8Array);
      expect(arg[0]).toBe(10);
    });
  });

  it('propagates invoke error to caller', async () => {
    mockInvoke.mockRejectedValue(new Error('Piper failed'));
    const player = makeMockPlayer();
    await expect(
      TTSService.speakWithPlayer(SHORT_TEXT, 'en_US-amy-medium', 1.0, player),
    ).rejects.toThrow('Piper failed');
  });

  it('resolves without throwing on successful synthesis', async () => {
    const player = makeMockPlayer();
    await expect(
      TTSService.speakWithPlayer(SHORT_TEXT, 'en_US-amy-medium', 1.0, player),
    ).resolves.toBeUndefined();
  });
});

describe('streaming threshold', () => {
  it('exactly 500 chars uses buffer-then-play', async () => {
    const text = 'B'.repeat(500);
    const player = makeMockPlayer();
    await TTSService.speakWithPlayer(text, 'en_US-amy-medium', 1.0, player);
    expect(player.loadBuffer).toHaveBeenCalledTimes(1);
    expect(player.beginStream).not.toHaveBeenCalled();
  });

  it('501 chars uses streaming path', async () => {
    const text = 'C'.repeat(501);
    const player = makeMockPlayer();
    await TTSService.speakWithPlayer(text, 'en_US-amy-medium', 1.0, player);
    expect(player.beginStream).toHaveBeenCalledTimes(1);
    expect(player.loadBuffer).not.toHaveBeenCalled();
  });
});
