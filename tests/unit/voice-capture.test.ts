/**
 * M6 (v1.5) — VoiceCapture & WAV encoding helpers.
 *
 * Covers:
 *   - encodeWav16kMono header structure + data length
 *   - resampleLinear correctness (downsample, upsample, identity)
 *   - VoiceCapture.start / stop round-trip with a fake MediaRecorder +
 *     stubbed `decodeAudio` so we never touch the real Web Audio stack.
 *   - Error paths: stop-before-start, start-called-twice.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  VoiceCapture,
  encodeWav16kMono,
  resampleLinear,
  TRANSCRIBE_TARGET_SAMPLE_RATE,
  type RecorderLike,
} from '@/features/dictation/voice/VoiceCapture';

describe('VoiceCapture (M6)', () => {
  describe('encodeWav16kMono', () => {
    it('produces the expected RIFF/WAVE header', () => {
      // Use a 16 kHz source so there's no resampling, and 10 samples of
      // silence.
      const pcm = new Float32Array(10);
      const wav = encodeWav16kMono(pcm, TRANSCRIBE_TARGET_SAMPLE_RATE);
      expect(wav.length).toBe(44 + 10 * 2); // header + samples*2 bytes

      const decoder = new TextDecoder('ascii');
      expect(decoder.decode(wav.slice(0, 4))).toBe('RIFF');
      expect(decoder.decode(wav.slice(8, 12))).toBe('WAVE');
      expect(decoder.decode(wav.slice(12, 16))).toBe('fmt ');
      expect(decoder.decode(wav.slice(36, 40))).toBe('data');

      // Sample rate is little-endian u32 at offset 24.
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(view.getUint32(24, true)).toBe(TRANSCRIBE_TARGET_SAMPLE_RATE);
      expect(view.getUint16(22, true)).toBe(1); // mono
      expect(view.getUint16(34, true)).toBe(16); // bits/sample
    });

    it('resamples a 48 kHz source to 16 kHz', () => {
      // 300 samples @ 48 kHz → 100 samples @ 16 kHz.
      const pcm = new Float32Array(300);
      const wav = encodeWav16kMono(pcm, 48000);
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(view.getUint32(40, true)).toBe(100 * 2); // data chunk size
    });

    it('clips out-of-range samples to int16 range', () => {
      const pcm = new Float32Array([2.5, -2.5, 0.5]);
      const wav = encodeWav16kMono(pcm, TRANSCRIBE_TARGET_SAMPLE_RATE);
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(view.getInt16(44, true)).toBe(0x7fff);
      expect(view.getInt16(46, true)).toBe(-0x8000);
      const half = view.getInt16(48, true);
      expect(Math.abs(half - 16383)).toBeLessThan(2);
    });
  });

  describe('resampleLinear', () => {
    it('returns the input unchanged for identity ratios', () => {
      const input = new Float32Array([1, 2, 3]);
      const out = resampleLinear(input, 16000, 16000);
      expect(out).toBe(input);
    });

    it('downsamples a ramp without introducing NaNs', () => {
      const input = new Float32Array(100);
      for (let i = 0; i < 100; i++) input[i] = i;
      const out = resampleLinear(input, 48000, 16000);
      expect(out.length).toBeGreaterThan(0);
      for (let i = 0; i < out.length; i++) {
        expect(Number.isFinite(out[i]!)).toBe(true);
      }
    });
  });

  describe('VoiceCapture lifecycle', () => {
    class FakeRecorder implements RecorderLike {
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      private listeners = new Map<string, Array<(ev: { data?: Blob; error?: Error }) => void>>();
      constructor(private chunk: Blob) {}
      start(): void {
        this.state = 'recording';
      }
      stop(): void {
        this.state = 'inactive';
        // Emit the data chunk, then stop.
        this.emit('dataavailable', { data: this.chunk });
        this.emit('stop', {});
      }
      addEventListener(
        event: 'dataavailable' | 'stop' | 'error',
        listener: (ev: { data?: Blob; error?: Error }) => void,
      ): void {
        const arr = this.listeners.get(event) ?? [];
        arr.push(listener);
        this.listeners.set(event, arr);
      }
      private emit(event: string, ev: { data?: Blob; error?: Error }): void {
        for (const l of this.listeners.get(event) ?? []) l(ev);
      }
    }

    it('returns WAV bytes after stop()', async () => {
      const stopTrack = vi.fn();
      const fakeStream = {
        getTracks: () => [{ stop: stopTrack }],
      } as unknown as MediaStream;
      // jsdom's Blob lacks .arrayBuffer(); patch it for this test.
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const fakeBlob = {
        type: 'audio/webm',
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      } as unknown as Blob;
      const fakeRecorder = new FakeRecorder(fakeBlob);

      const pcm = new Float32Array(160); // 10ms @ 16kHz
      // Tag with a sampleRate property (how our real decode does it)
      (pcm as unknown as { sampleRate: number }).sampleRate = 16000;

      const capture = new VoiceCapture({
        getUserMedia: vi.fn().mockResolvedValue(fakeStream),
        createRecorder: () => fakeRecorder,
        decodeAudio: async () => pcm,
      });

      await capture.start();
      expect(fakeRecorder.state).toBe('recording');

      const wavPromise = capture.stop();
      const wav = await wavPromise;

      expect(wav).toBeInstanceOf(Uint8Array);
      expect(wav.length).toBe(44 + 160 * 2);
      // Tracks were stopped so the mic indicator disappears.
      expect(stopTrack).toHaveBeenCalled();
    });

    it('rejects stop() if start() was never called', async () => {
      const capture = new VoiceCapture({
        getUserMedia: vi.fn(),
        createRecorder: vi.fn(),
        decodeAudio: async () => new Float32Array(0),
      });
      await expect(capture.stop()).rejects.toThrow(/before start/);
    });

    it('throws when start() is called twice', async () => {
      const stream = { getTracks: () => [] } as unknown as MediaStream;
      const recorder = new (class extends (FakeRecorder as unknown as new (b: Blob) => RecorderLike) {})(
        new Blob([]),
      ) as RecorderLike;
      const capture = new VoiceCapture({
        getUserMedia: vi.fn().mockResolvedValue(stream),
        createRecorder: () => recorder,
        decodeAudio: async () => new Float32Array(0),
      });
      await capture.start();
      await expect(capture.start()).rejects.toThrow(/called twice/);
    });
  });
});
