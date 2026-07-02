/**
 * Task 20 — tts_played audit event
 *
 * TTSService.speak() must emit a structured tts_played AuditEvent after each
 * successful synthesis call. The event carries:
 *   - type: 'tts_played'
 *   - timestamp: ISO 8601 string
 *   - payload.textLength: number of characters in the synthesized text
 *   - payload.voiceId: the Piper voice ID used
 *
 * Covers:
 *   - speak() emits tts_played on success with correct textLength and voiceId
 *   - speak() does NOT emit tts_played when invoke throws (synthesis failed)
 *   - timestamp is an ISO string (date-parseable)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri invoke BEFORE importing TTSService.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

// Mock AuditService to capture append() calls.
// We define a shared spy holder accessed through the mock's captured scope.
// Cannot reference outer `const` here due to hoisting — define the spy inside
// the factory and export it through a module-scoped reference object.
const auditSpy = { append: vi.fn() };

vi.mock('@/platform/audit/AuditService', () => {
  // AuditService is a class; use a regular function constructor so that
  // `new AuditService()` works correctly in the module under test.
  function AuditService() {
    // Intentionally empty — we assign the spy to the prototype below.
  }
  // Attach the spy as the prototype method so all instances share it.
  // The spy itself is defined outside so tests can reference auditSpy.append.
  AuditService.prototype.append = (...args: unknown[]) =>
    auditSpy.append(...args);
  return { AuditService };
});

import * as tauriCore from '@tauri-apps/api/core';
import { TTSService } from '@/features/dictation/engine/TTSService';

const mockInvoke = vi.mocked(tauriCore.invoke);
const mockIsTauri = vi.mocked(tauriCore.isTauri);

describe('TTSService audit logging', () => {
  beforeEach(() => {
    TTSService._resetCache();
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    // Default: tts_speak returns a small fake WAV array.
    mockInvoke.mockResolvedValue(new Array(44).fill(0));
  });

  afterEach(() => {
    TTSService._resetCache();
  });

  it('emits tts_played event after successful speak()', async () => {
    await TTSService.speak('Hello world', 'en_US-amy-medium', 1.0);
    expect(auditSpy.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tts_played',
        payload: expect.objectContaining({
          textLength: 'Hello world'.length,
          voiceId: 'en_US-amy-medium',
        }),
      }),
    );
  });

  it('payload.textLength matches the synthesized text length', async () => {
    const text = 'A longer piece of text for testing.';
    await TTSService.speak(text, 'en_US-amy-medium', 1.0);
    const call = auditSpy.append.mock.calls[0]![0] as { payload: { textLength: number } };
    expect(call.payload.textLength).toBe(text.length);
  });

  it('payload.voiceId matches the requested voice', async () => {
    await TTSService.speak('Test', 'de_DE-thorsten-medium', 1.5);
    const call = auditSpy.append.mock.calls[0]![0] as { payload: { voiceId: string } };
    expect(call.payload.voiceId).toBe('de_DE-thorsten-medium');
  });

  it('timestamp is an ISO date string', async () => {
    await TTSService.speak('Hello', 'en_US-amy-medium', 1.0);
    const call = auditSpy.append.mock.calls[0]![0] as { timestamp: string };
    const parsed = new Date(call.timestamp);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it('does NOT emit tts_played when speak() throws', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Piper binary missing'));
    await expect(
      TTSService.speak('Hello', 'en_US-amy-medium', 1.0),
    ).rejects.toThrow('Piper binary missing');
    expect(auditSpy.append).not.toHaveBeenCalled();
  });

  it('does NOT emit tts_played in browser mode', async () => {
    mockIsTauri.mockReturnValue(false);
    await expect(
      TTSService.speak('Hello', 'en_US-amy-medium', 1.0),
    ).rejects.toThrow(/desktop app/i);
    expect(auditSpy.append).not.toHaveBeenCalled();
  });
});
