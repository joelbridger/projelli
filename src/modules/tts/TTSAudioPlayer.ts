/**
 * TTSAudioPlayer — Web Audio API playback for synthesized WAV bytes.
 *
 * Buffered playback mode: the caller loads a full WAV buffer once
 * (`loadBuffer`), then `play()` / `pause()` / `stop()` control playback
 * through a single AudioBufferSourceNode.
 *
 * For long responses the spec describes a streaming ring-buffer approach;
 * that is a future enhancement. This class covers the short-response path
 * (all WAV bytes returned at once, text length ≤ 500 chars).
 *
 * Status machine:
 *   idle → (loadBuffer + play) → playing → pause() → paused
 *   paused → play() → playing
 *   playing | paused → stop() → idle
 *   source.onended fires → idle, onEnded callback fires
 */

export type PlayerStatus = 'idle' | 'playing' | 'paused' | 'streaming';

export interface TTSAudioPlayerOptions {
  /** Called when audio finishes playing naturally (not via stop()). */
  onEnded?: () => void;
}

export class TTSAudioPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private _status: PlayerStatus = 'idle';
  private readonly _onEnded: (() => void) | undefined;

  // ---------------------------------------------------------------------------
  // Streaming state
  // ---------------------------------------------------------------------------

  /**
   * Accumulated chunks from beginStream / appendChunk calls.
   * null when not in a streaming session.
   */
  private _streamChunks: Uint8Array[] | null = null;

  constructor(opts?: TTSAudioPlayerOptions) {
    this._onEnded = opts?.onEnded ?? undefined;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get status(): PlayerStatus {
    return this._status;
  }

  /**
   * Duration in seconds of the loaded buffer, or 0 if nothing is loaded.
   */
  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  isPlaying(): boolean {
    return this._status === 'playing';
  }

  /**
   * Decode raw WAV bytes into an AudioBuffer ready for playback.
   * Must be called before play().
   */
  async loadBuffer(wav: Uint8Array): Promise<void> {
    this._ensureContext();
    const arrayBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
    this.buffer = await (this.ctx!).decodeAudioData(arrayBuffer as ArrayBuffer);
  }

  /**
   * Start (or resume) playback.
   * @throws If called before loadBuffer().
   */
  play(): void {
    if (!this.buffer) {
      throw new Error('No audio buffer loaded. Call loadBuffer() first.');
    }
    this._ensureContext();
    const ctx = this.ctx!;

    if (this._status === 'paused') {
      // Resume a suspended context.
      void ctx.resume();
      this._status = 'playing';
      return;
    }

    // Tear down any previous source before creating a new one.
    this._teardownSource();

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(ctx.destination);
    src.onended = (_ev: Event) => {
      // Only transition to idle if this source is still the active one
      // (stop() may have already replaced it).
      if (this.source === src) {
        this.source = null;
        this._status = 'idle';
        this._onEnded?.();
      }
    };
    src.start();
    this.source = src;
    this._status = 'playing';
  }

  /**
   * Pause playback by suspending the AudioContext.
   * No-op if not currently playing.
   */
  async pause(): Promise<void> {
    if (this._status !== 'playing') return;
    await this.ctx?.suspend();
    this._status = 'paused';
  }

  /**
   * Stop playback and reset to idle.
   * Also clears any in-progress streaming session.
   * No-op if already idle.
   */
  stop(): void {
    this._teardownSource();
    this._streamChunks = null;
    this._status = 'idle';
  }

  // ---------------------------------------------------------------------------
  // Streaming API (v2.0 — buffer-then-play implementation)
  //
  // Call sites use beginStream / appendChunk / finishStream so the interface
  // is stable for a future per-chunk ring-buffer upgrade. For v2.0 the full
  // WAV payload is accumulated in memory and decoded once finishStream() is
  // called — identical end-user latency to the single-call speak() path but
  // with a stable streaming contract for callers.
  // ---------------------------------------------------------------------------

  /**
   * Open a streaming session. Clears any previously accumulated chunks.
   * Status transitions to 'streaming'.
   */
  beginStream(): void {
    this._teardownSource();
    this._streamChunks = [];
    this._status = 'streaming';
  }

  /**
   * Append a WAV-byte chunk to the in-progress stream.
   * @throws If called before beginStream().
   */
  appendChunk(bytes: Uint8Array): void {
    if (this._streamChunks === null) {
      throw new Error(
        'Stream not started. Call beginStream() before appendChunk().',
      );
    }
    this._streamChunks.push(bytes);
  }

  /**
   * Finish the streaming session: concatenate all chunks, decode, and play.
   *
   * If no chunks were appended, transitions back to idle without playing.
   * @throws If called before beginStream().
   */
  async finishStream(): Promise<void> {
    if (this._streamChunks === null) {
      throw new Error(
        'Stream not started. Call beginStream() before finishStream().',
      );
    }

    const chunks = this._streamChunks;
    this._streamChunks = null;

    if (chunks.length === 0) {
      this._status = 'idle';
      return;
    }

    // Concatenate all chunks into a single Uint8Array.
    const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    await this.loadBuffer(merged);
    this.play();
  }

  /**
   * Release all Web Audio resources.
   * After dispose(), the player cannot be reused.
   */
  async dispose(): Promise<void> {
    this._teardownSource();
    this._status = 'idle';
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.buffer = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _ensureContext(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
  }

  private _teardownSource(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // Already stopped — ignore.
      }
      this.source.disconnect();
      this.source = null;
    }
  }
}
