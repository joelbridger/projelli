// src/platform/providers/resolveLocalProvider.ts
//
// Single source of truth for resolving the on-device ("local") generation
// provider, shared by every surface that runs inference locally: Ask / Chat,
// Client Map, Matter-at-a-Glance, email "Draft with AI", and the Workflow
// engine.
//
// THE RULE (one consistent on-device default everywhere): prefer the embedded
// Advisor Prep Hero Local AI engine (llama.cpp sidecar) when its model is downloaded and
// READY, and fall back to the user's own Ollama daemon otherwise. Both keep ALL
// inference on the user's machine — this only ever changes WHICH local engine
// runs, never whether anything leaves. Centralising it here means a machine with
// the embedded model but no Ollama never fails private-mode generation with
// "Local AI unreachable" (the class-of-bug this module exists to prevent).
//
// `localLlmModelStatus` is desktop-only and returns a non-'ready' value (or
// throws) off-desktop; any such result falls through to Ollama.

import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import { AppLocalProvider } from '@/platform/providers/AppLocalProvider';
import { localLlmModelStatus } from '@/platform/utils/tauri-commands';
import type { Provider } from '@/platform/providers/Provider';

export interface ResolvedLocalProvider {
  provider: Provider;
  providerId: 'lantern-local' | 'ollama';
  model: string;
}

/**
 * True when the embedded Advisor Prep Hero Local AI model is downloaded and ready right
 * now. Never throws — off-desktop or on any probe error it resolves `false`.
 *
 * Used by surfaces that resolve through a PURE helper (the workflow engine's
 * resolveWorkflowProvider) and therefore need the boolean fact rather than a
 * constructed provider.
 */
export async function isEmbeddedLocalModelReady(): Promise<boolean> {
  try {
    return (await localLlmModelStatus()) === 'ready';
  } catch {
    return false;
  }
}

/**
 * Resolve the local generation provider: embedded Advisor Prep Hero Local AI when ready,
 * else the user's Ollama daemon. See the module header for the rule.
 */
export async function resolveLocalGenerationProvider(): Promise<ResolvedLocalProvider> {
  if (await isEmbeddedLocalModelReady()) {
    const provider = new AppLocalProvider({});
    return { provider, providerId: 'lantern-local', model: provider.getMetadata().model };
  }
  const provider = new OllamaProvider({});
  return { provider, providerId: 'ollama', model: provider.getMetadata().model };
}

/**
 * Resolve a local generation provider only when one is actually available.
 *
 * This is stricter than `resolveLocalGenerationProvider()`, which intentionally
 * falls back to Ollama in Local-only mode so the send path can surface the
 * existing "Ollama is not running" error. Non-local modes use this stricter
 * helper before claiming "local AI" in the privacy badge or send path.
 */
export async function resolveAvailableLocalGenerationProvider(): Promise<ResolvedLocalProvider | null> {
  if (await isEmbeddedLocalModelReady()) {
    const provider = new AppLocalProvider({});
    return { provider, providerId: 'lantern-local', model: provider.getMetadata().model };
  }

  try {
    const { detectOllama } = await import('@/platform/providers/OllamaProvider');
    const status = await detectOllama();
    if (!status.reachable) return null;
  } catch {
    return null;
  }

  const provider = new OllamaProvider({});
  return { provider, providerId: 'ollama', model: provider.getMetadata().model };
}
