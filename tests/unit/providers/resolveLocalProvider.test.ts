/**
 * F-503 — Shared on-device ("local") provider resolution.
 *
 * resolveLocalGenerationProvider is the single source of truth used by every
 * surface that runs inference locally (Ask / Chat, Client Map, Matter-at-a-
 * Glance, email "Draft with AI", and the Workflow engine). The rule: prefer the
 * embedded Lantern Local AI when its model is downloaded + READY, else fall
 * back to the user's Ollama daemon. Both stay on-device — this only changes
 * WHICH local engine runs, never whether anything leaves.
 *
 * These tests use the REAL provider classes (getMetadata() is synchronous and
 * needs no sidecar) and mock only the desktop model-status probe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));

vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const real = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...real, localLlmModelStatus: mocks.status };
});

import {
  resolveLocalGenerationProvider,
  isEmbeddedLocalModelReady,
} from '@/platform/providers/resolveLocalProvider';

beforeEach(() => {
  mocks.status.mockReset();
});

describe('resolveLocalGenerationProvider', () => {
  it('embedded model READY → embedded Lantern Local AI', async () => {
    mocks.status.mockResolvedValue('ready');
    const r = await resolveLocalGenerationProvider();
    expect(r.providerId).toBe('lantern-local');
    expect(r.provider.getMetadata().providerId).toBe('lantern-local');
  });

  it('embedded model ABSENT → the user Ollama daemon', async () => {
    mocks.status.mockResolvedValue('absent');
    const r = await resolveLocalGenerationProvider();
    expect(r.providerId).toBe('ollama');
    expect(r.provider.getMetadata().providerId).toBe('ollama');
  });

  it('embedded model DOWNLOADING (not yet ready) → Ollama', async () => {
    mocks.status.mockResolvedValue('downloading');
    const r = await resolveLocalGenerationProvider();
    expect(r.providerId).toBe('ollama');
  });

  it('probe THROWS (off-desktop / no Tauri) → Ollama, never throws', async () => {
    mocks.status.mockRejectedValue(new Error('not in tauri'));
    const r = await resolveLocalGenerationProvider();
    expect(r.providerId).toBe('ollama');
  });
});

describe('isEmbeddedLocalModelReady', () => {
  it('true only when the probe reports ready', async () => {
    mocks.status.mockResolvedValue('ready');
    expect(await isEmbeddedLocalModelReady()).toBe(true);
  });

  it('false when absent', async () => {
    mocks.status.mockResolvedValue('absent');
    expect(await isEmbeddedLocalModelReady()).toBe(false);
  });

  it('false (never throws) when the probe errors', async () => {
    mocks.status.mockRejectedValue(new Error('boom'));
    expect(await isEmbeddedLocalModelReady()).toBe(false);
  });
});
