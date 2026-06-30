/**
 * VoiceCapture (M6, v1.5 — Flag 4).
 *
 * Tiny wrapper around `navigator.mediaDevices.getUserMedia` +
 * `MediaRecorder` that captures short microphone audio clips and exposes
 * them as WAV bytes ready to ship to the Parakeet/whisper.cpp sidecar.
 *
 * Design notes:
 *   - MediaRecorder emits WebM/Opus by default on most browsers/Tauri builds.
 *     We decode with an AudioContext and re-encode as 16-bit mono WAV @
 *     16 kHz — the sample rate whisper/Parakeet expects.
 *   - The capture session is intentionally single-use: call `start()`, then
 *     `stop()` to get bytes. Use a new instance for each utterance.
 *   - Everything is dependency-injected (media stream factory, recorder
 *     factory, audio context factory) so the unit tests can simulate
 *     MediaRecorder without jsdom loaders.
 */

/** WAV sample rate we resample to before shipping to the sidecar. */
export const TRANSCRIBE_TARGET_SAMPLE_RATE = 16000;

/** Minimal subset of `MediaRecorder` we rely on. */
export interface RecorderLike {
  start(): void;
  stop(): void;
  addEventListener(
    event: 'dataavailable' | 'stop' | 'error',
    listener: (ev: { data?: Blob; error?: Error }) => void,
  ): void;
  state: 'inactive' | 'recording' | 'paused';
}

/** Factories injected for testability. Each defaults to the browser global. */
export interface VoiceCaptureDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder?: (stream: MediaStream) => RecorderLike;
  decodeAudio?: (bytes: ArrayBuffer) => Promise<Float32Array>;
}

/**
 * Convert a Float32 mono PCM buffer @ any sample rate to a 16-bit PCM WAV
 * file (mono, 16 kHz). Exported for testing and for callers that already
 * have decoded audio.
 */
export function encodeWav16kMono(samples: Float32Array, sourceRate: number): Uint8Array {
  const target = TRANSCRIBE_TARGET_SAMPLE_RATE;
  const resampled = sourceRate === target ? samples : resampleLinear(samples, sourceRate, target);

  const pcm = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const headerSize = 44;
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(headerSize + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, target, true);
  view.setUint32(28, target * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const bytes = new Uint8Array(buffer);
  const pcmBytes = new Uint8Array(pcm.buffer);
  bytes.set(pcmBytes, headerSize);
  return bytes;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Simple linear-interpolation resampler. Good enough for speech input. */
export function resampleLinear(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return input;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
  return out;
}

/**
 * Read Blob chunks into a single ArrayBuffer. Defensive against jsdom
 * environments whose Blob constructor doesn't aggregate buffers — in
 * those cases we pull each chunk's own arrayBuffer() and concatenate.
 */
async function blobsToArrayBuffer(chunks: Blob[]): Promise<ArrayBuffer> {
  if (chunks.length === 0) return new ArrayBuffer(0);
  const bufs: ArrayBuffer[] = [];
  for (const c of chunks) {
    if (typeof (c as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
      bufs.push(await c.arrayBuffer());
    }
  }
  if (bufs.length === 1) return bufs[0]!;
  const total = bufs.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) {
    out.set(new Uint8Array(b), off);
    off += b.byteLength;
  }
  return out.buffer;
}

async function defaultDecode(bytes: ArrayBuffer): Promise<Float32Array> {
  const Ctx = (window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('AudioContext not available');
  const ctx = new Ctx();
  const audio = await ctx.decodeAudioData(bytes.slice(0));
  const channel = audio.getChannelData(0);
  // Copy into a plain Float32Array owned by us (avoid holding a reference
  // to the decoded AudioBuffer after the context closes).
  const out = new Float32Array(channel.length);
  out.set(channel);
  await ctx.close?.();
  // Tag the output so `encodeWav16kMono` picks the right source rate.
  (out as unknown as { sampleRate?: number }).sampleRate = audio.sampleRate;
  return out;
}

/**
 * VoiceCapture — start/stop microphone recording and receive WAV bytes
 * ready for transcription. Single-use per instance.
 */
export class VoiceCapture {
  private deps: Required<VoiceCaptureDeps>;
  private stream: MediaStream | null = null;
  private recorder: RecorderLike | null = null;
  private chunks: Blob[] = [];
  private resolveStop: ((wav: Uint8Array) => void) | null = null;
  private rejectStop: ((err: Error) => void) | null = null;

  constructor(deps: VoiceCaptureDeps = {}) {
    this.deps = {
      getUserMedia:
        deps.getUserMedia ??
        ((constraints) => {
          const nav = (typeof navigator !== 'undefined'
            ? navigator
            : (undefined as unknown as Navigator)) as Navigator & {
            mediaDevices?: MediaDevices;
          };
          if (!nav?.mediaDevices?.getUserMedia) {
            return Promise.reject(new Error('getUserMedia is not available'));
          }
          return nav.mediaDevices.getUserMedia(constraints);
        }),
      createRecorder:
        deps.createRecorder ??
        ((stream) => {
          const Rec = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
          if (!Rec) throw new Error('MediaRecorder not available');
          return new Rec(stream) as unknown as RecorderLike;
        }),
      decodeAudio: deps.decodeAudio ?? defaultDecode,
    };
  }

  /** Ask for mic access and start recording. Resolves once recording started. */
  async start(): Promise<void> {
    if (this.recorder) throw new Error('VoiceCapture.start() called twice');
    this.stream = await this.deps.getUserMedia({ audio: true });
    this.recorder = this.deps.createRecorder(this.stream);
    this.chunks = [];
    this.recorder.addEventListener('dataavailable', (ev) => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    });
    this.recorder.addEventListener('stop', () => {
      void this.finalize();
    });
    this.recorder.addEventListener('error', (ev) => {
      const err = ev.error ?? new Error('recorder error');
      if (this.rejectStop) {
        this.rejectStop(err);
      }
    });
    this.recorder.start();
  }

  /**
   * Stop recording and resolve with WAV bytes (16 kHz mono 16-bit PCM).
   * Tracks are stopped too so the mic indicator goes away.
   */
  stop(): Promise<Uint8Array> {
    if (!this.recorder) return Promise.reject(new Error('VoiceCapture.stop() before start()'));
    return new Promise((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
      try {
        this.recorder?.stop();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private async finalize(): Promise<void> {
    try {
      // Drop the mic indicator ASAP.
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;

      // Read the chunk bytes. If we received a single Blob chunk use
      // its arrayBuffer() directly; otherwise concatenate manually so
      // we don't rely on jsdom's (missing) Blob constructor.
      const buf = await blobsToArrayBuffer(this.chunks);
      const pcm = await this.deps.decodeAudio(buf);
      const sourceRate = (pcm as unknown as { sampleRate?: number }).sampleRate ?? 48000;
      const wav = encodeWav16kMono(pcm, sourceRate);
      this.resolveStop?.(wav);
    } catch (e) {
      this.rejectStop?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.resolveStop = null;
      this.rejectStop = null;
      this.recorder = null;
    }
  }
}
