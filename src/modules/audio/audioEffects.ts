// Audio Effects Utility
// Pure functions that operate on AudioBuffer - all immutable (return new buffer, don't mutate input)
//
// Time conversion: sample index = Math.floor(time * buffer.sampleRate)
// Multi-channel support: processes each channel independently

/**
 * Clone an AudioBuffer into a new AudioBuffer with identical samples.
 */
function cloneBuffer(buffer: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const out = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src);
  }
  return out;
}

/**
 * Resolve a [startTime, endTime] pair (possibly undefined) to sample index range
 * clamped to [0, buffer.length]. Ensures startSample <= endSample.
 */
function resolveRange(
  buffer: AudioBuffer,
  startTime?: number,
  endTime?: number
): { startSample: number; endSample: number } {
  const total = buffer.length;
  let startSample = startTime === undefined ? 0 : Math.floor(startTime * buffer.sampleRate);
  let endSample = endTime === undefined ? total : Math.floor(endTime * buffer.sampleRate);
  if (startSample < 0) startSample = 0;
  if (endSample > total) endSample = total;
  if (endSample < startSample) endSample = startSample;
  return { startSample, endSample };
}

/**
 * Apply constant gain to all samples in the region.
 * gainDb in decibels (0 = no change, 6 ≈ double, -6 ≈ half).
 */
export function applyGain(
  buffer: AudioBuffer,
  ctx: AudioContext,
  gainDb: number,
  startTime?: number,
  endTime?: number
): AudioBuffer {
  const out = cloneBuffer(buffer, ctx);
  const { startSample, endSample } = resolveRange(buffer, startTime, endTime);
  const multiplier = Math.pow(10, gainDb / 20);

  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = startSample; i < endSample; i++) {
      const v = data[i];
      if (v !== undefined) {
        data[i] = v * multiplier;
      }
    }
  }
  return out;
}

/**
 * Linear fade in from silence to full over the region.
 */
export function applyFadeIn(
  buffer: AudioBuffer,
  ctx: AudioContext,
  startTime?: number,
  endTime?: number
): AudioBuffer {
  const out = cloneBuffer(buffer, ctx);
  const { startSample, endSample } = resolveRange(buffer, startTime, endTime);
  const length = endSample - startSample;
  if (length <= 0) return out;

  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = startSample; i < endSample; i++) {
      const v = data[i];
      if (v !== undefined) {
        const ramp = (i - startSample) / length;
        data[i] = v * ramp;
      }
    }
  }
  return out;
}

/**
 * Linear fade out from full to silence over the region.
 */
export function applyFadeOut(
  buffer: AudioBuffer,
  ctx: AudioContext,
  startTime?: number,
  endTime?: number
): AudioBuffer {
  const out = cloneBuffer(buffer, ctx);
  const { startSample, endSample } = resolveRange(buffer, startTime, endTime);
  const length = endSample - startSample;
  if (length <= 0) return out;

  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = startSample; i < endSample; i++) {
      const v = data[i];
      if (v !== undefined) {
        const ramp = 1 - (i - startSample) / length;
        data[i] = v * ramp;
      }
    }
  }
  return out;
}

/**
 * Find peak sample absolute value in the region, scale all samples so peak = targetPeak.
 * targetPeak defaults to 0.99 (clamp to avoid clipping).
 */
export function applyNormalize(
  buffer: AudioBuffer,
  ctx: AudioContext,
  targetPeak: number = 0.99,
  startTime?: number,
  endTime?: number
): AudioBuffer {
  const out = cloneBuffer(buffer, ctx);
  const { startSample, endSample } = resolveRange(buffer, startTime, endTime);
  // Clamp target to avoid clipping at exactly 1.0
  const clampedTarget = Math.min(Math.abs(targetPeak), 0.99);

  // First pass: find peak across all channels in the region
  let peak = 0;
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = startSample; i < endSample; i++) {
      const v = data[i];
      if (v !== undefined) {
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
      }
    }
  }

  if (peak === 0) return out;
  const scale = clampedTarget / peak;

  // Second pass: apply scale
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = startSample; i < endSample; i++) {
      const v = data[i];
      if (v !== undefined) {
        data[i] = v * scale;
      }
    }
  }
  return out;
}

/**
 * Reverse samples in the region (or full buffer if no range given).
 */
export function applyReverse(
  buffer: AudioBuffer,
  ctx: AudioContext,
  startTime?: number,
  endTime?: number
): AudioBuffer {
  const out = cloneBuffer(buffer, ctx);
  const { startSample, endSample } = resolveRange(buffer, startTime, endTime);
  const length = endSample - startSample;
  if (length <= 1) return out;

  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    // Copy region, reverse, write back
    const region = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const v = data[startSample + i];
      region[i] = v === undefined ? 0 : v;
    }
    // Reverse in place
    for (let i = 0; i < length; i++) {
      const v = region[length - 1 - i];
      data[startSample + i] = v === undefined ? 0 : v;
    }
  }
  return out;
}

/**
 * Slice a buffer by time range, return a new buffer containing just that region.
 */
export function sliceBuffer(
  buffer: AudioBuffer,
  ctx: AudioContext,
  startTime: number,
  endTime: number
): AudioBuffer {
  const { startSample, endSample } = resolveRange(buffer, startTime, endTime);
  const length = Math.max(0, endSample - startSample);
  const out = ctx.createBuffer(
    buffer.numberOfChannels,
    Math.max(1, length),
    buffer.sampleRate
  );
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const v = src[startSample + i];
      dst[i] = v === undefined ? 0 : v;
    }
  }
  return out;
}

/**
 * Concatenate multiple buffers in order. All buffers must share the same
 * sample rate. Channel count is the max across inputs; missing channels get silence.
 */
export function concatBuffers(
  buffers: AudioBuffer[],
  ctx: AudioContext
): AudioBuffer {
  if (buffers.length === 0) {
    return ctx.createBuffer(1, 1, 44100);
  }
  const first = buffers[0]!;
  let totalLength = 0;
  let maxChannels = 0;
  for (const b of buffers) {
    totalLength += b.length;
    if (b.numberOfChannels > maxChannels) maxChannels = b.numberOfChannels;
  }
  const out = ctx.createBuffer(maxChannels, Math.max(1, totalLength), first.sampleRate);

  let offset = 0;
  for (const b of buffers) {
    for (let ch = 0; ch < maxChannels; ch++) {
      const dst = out.getChannelData(ch);
      // If source lacks this channel, use channel 0 (mono expansion) or silence.
      const srcChannel = ch < b.numberOfChannels ? ch : 0;
      const src = b.getChannelData(srcChannel);
      for (let i = 0; i < b.length; i++) {
        const v = src[i];
        dst[offset + i] = v === undefined ? 0 : v;
      }
    }
    offset += b.length;
  }
  return out;
}

/**
 * Replace a time region in `buffer` with `replacement`.
 * Result length = (buffer up to startTime) + replacement + (buffer after endTime).
 */
export function spliceBuffer(
  buffer: AudioBuffer,
  ctx: AudioContext,
  startTime: number,
  endTime: number,
  replacement: AudioBuffer
): AudioBuffer {
  const { startSample, endSample } = resolveRange(buffer, startTime, endTime);
  const before = sliceBuffer(buffer, ctx, 0, startSample / buffer.sampleRate);
  const after = sliceBuffer(buffer, ctx, endSample / buffer.sampleRate, buffer.length / buffer.sampleRate);

  // sliceBuffer enforces min length 1 even when the range is empty; compensate
  // by only including before/after if they have meaningful length.
  const parts: AudioBuffer[] = [];
  if (startSample > 0) parts.push(before);
  parts.push(replacement);
  if (endSample < buffer.length) parts.push(after);
  if (parts.length === 0) return cloneBuffer(replacement, ctx);
  return concatBuffers(parts, ctx);
}

/**
 * Insert a buffer at a point in time. Result length = buffer + insertion.
 */
export function insertBuffer(
  buffer: AudioBuffer,
  ctx: AudioContext,
  insertAtTime: number,
  insertion: AudioBuffer
): AudioBuffer {
  const total = buffer.length;
  let insertSample = Math.floor(insertAtTime * buffer.sampleRate);
  if (insertSample < 0) insertSample = 0;
  if (insertSample > total) insertSample = total;
  const insertSeconds = insertSample / buffer.sampleRate;
  return spliceBuffer(buffer, ctx, insertSeconds, insertSeconds, insertion);
}
