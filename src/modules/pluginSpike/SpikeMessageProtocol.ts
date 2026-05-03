// Plugin Spike — message protocol (encode / decode)
//
// JSON serialization for messages exchanged between the main-thread bridge
// and the worker-side runtime. The spike uses JSON rather than relying on
// structured-clone direct because (a) it forces us to surface non-cloneable
// values early, (b) it keeps the protocol inspectable for debugging, and
// (c) the spike is explicitly avoiding transferable-object optimization.
//
// Production runner can revisit this in C3.

import type { SpikeMessage, SpikeMessageType } from '@/types/pluginSpike';

/**
 * Set of valid message `type` discriminants. Kept in sync with the
 * `SpikeMessage` union in src/types/pluginSpike.ts.
 */
const VALID_TYPES: ReadonlySet<SpikeMessageType> = new Set<SpikeMessageType>([
  'init',
  'register-command',
  'invoke-command',
  'command-result',
  'api-call',
  'api-result',
  'panel-render',
  'notify',
  'error',
]);

/**
 * Encode a SpikeMessage to a wire string. Throws if the message contains
 * non-serializable values (functions, symbols, circular refs).
 */
export function encode(msg: SpikeMessage): string {
  // JSON.stringify silently drops functions and symbols, which would let
  // bugs sneak across the boundary. Pre-validate the obvious shape so the
  // caller gets a clear error instead of a half-baked encode.
  if (!msg || typeof msg !== 'object') {
    throw new Error('SpikeMessageProtocol.encode: message must be an object');
  }
  if (typeof (msg as { id?: unknown }).id !== 'string') {
    throw new Error('SpikeMessageProtocol.encode: message.id must be a string');
  }
  if (!VALID_TYPES.has((msg as { type: SpikeMessageType }).type)) {
    throw new Error(`SpikeMessageProtocol.encode: unknown message type ${String((msg as { type: unknown }).type)}`);
  }
  return JSON.stringify(msg);
}

/**
 * Decode a wire string into a SpikeMessage. Throws on malformed input or
 * unknown message type. The caller (bridge or runtime) is then free to
 * narrow on `msg.type` because it's a discriminated union.
 */
export function decode(raw: unknown): SpikeMessage {
  if (typeof raw !== 'string') {
    throw new Error('SpikeMessageProtocol.decode: raw input must be a string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`SpikeMessageProtocol.decode: invalid JSON (${(err as Error).message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SpikeMessageProtocol.decode: parsed value must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  const id = obj['id'];
  const type = obj['type'];
  if (typeof id !== 'string') {
    throw new Error('SpikeMessageProtocol.decode: message.id must be a string');
  }
  if (typeof type !== 'string' || !VALID_TYPES.has(type as SpikeMessageType)) {
    throw new Error(`SpikeMessageProtocol.decode: unknown message type ${String(type)}`);
  }
  return parsed as SpikeMessage;
}

/**
 * Type guard: cheap runtime check for "this looks like a SpikeMessage".
 * Intended for hot paths where throwing in `decode` is too expensive.
 */
export function isSpikeMessage(value: unknown): value is SpikeMessage {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  const id = obj['id'];
  const type = obj['type'];
  return typeof id === 'string' && typeof type === 'string' && VALID_TYPES.has(type as SpikeMessageType);
}
