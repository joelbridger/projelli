/**
 * ollamaSetup.ts — helpers for the guided local-AI setup flow in Ch5LocalSetup.
 *
 * These functions are designed so:
 *  - No terminal commands are ever shown to the user.
 *  - Model download is driven entirely over HTTP (Ollama's /api/pull endpoint).
 *  - Polling and downloads can be cancelled cleanly via AbortSignal.
 *
 * Reuses OLLAMA_DEFAULT_BASE_URL and OLLAMA_DEFAULT_MODEL from OllamaProvider.
 * Reuses detectOllama for the ping check.
 */

import {
  detectOllama,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MODEL,
} from '@/platform/providers/OllamaProvider';

// Re-export for convenience so callers can import model/url from one place.
export { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL };

// ---------------------------------------------------------------------------
// waitForOllama
// ---------------------------------------------------------------------------

export type WaitForOllamaResult = 'ready' | 'no-model' | 'unreachable';

export interface WaitForOllamaOpts {
  signal?: AbortSignal;
  /** How often to poll (ms). Default: 2000 */
  intervalMs?: number;
  /** How long before giving up and resolving 'unreachable' (ms). Default: 600_000 */
  timeoutMs?: number;
}

/**
 * Poll detectOllama until:
 *  - 'ready'       — Ollama is reachable AND has at least one model installed.
 *  - 'no-model'    — Ollama is reachable but has no models yet.
 *  - 'unreachable' — timed out without ever reaching Ollama.
 *
 * Resolves immediately on the first positive result. Cancelling via signal
 * resolves with 'unreachable' so callers can enter the error state.
 */
export async function waitForOllama(opts: WaitForOllamaOpts = {}): Promise<WaitForOllamaResult> {
  const { signal, intervalMs = 2000, timeoutMs = 600_000 } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) return 'unreachable';

    const result = await detectOllama(OLLAMA_DEFAULT_BASE_URL);

    if (result.reachable && result.models.length > 0) return 'ready';
    if (result.reachable && result.models.length === 0) return 'no-model';

    // Not reachable yet — wait before retrying.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });

    if (signal?.aborted) return 'unreachable';
  }

  return 'unreachable';
}

// ---------------------------------------------------------------------------
// pullOllamaModel
// ---------------------------------------------------------------------------

export interface PullProgress {
  percent: number;
  status: string;
}

export interface PullOllamaModelOpts {
  onProgress: (p: PullProgress) => void;
  signal?: AbortSignal;
  /** Override the base URL (useful in tests). Default: OLLAMA_DEFAULT_BASE_URL */
  baseUrl?: string;
}

/**
 * Download an Ollama model via the /api/pull streaming endpoint.
 *
 * The response is newline-delimited JSON (NDJSON). Each line has the shape:
 *   { status: string; completed?: number; total?: number; error?: string }
 *
 * Progress is derived from completed/total when both are present.
 * Resolves when a line has status === 'success' or the stream ends cleanly.
 * Rejects on an { error } line or any network failure.
 */
export async function pullOllamaModel(
  model: string,
  opts: PullOllamaModelOpts,
): Promise<void> {
  const { onProgress, signal, baseUrl = OLLAMA_DEFAULT_BASE_URL } = opts;

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: signal ?? null,
    });
  } catch (err) {
    throw new Error(
      `Could not reach Ollama to start the download. Check that Ollama is running. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!resp.ok) {
    throw new Error(`Ollama returned an error (HTTP ${resp.status}) when starting the download.`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error('Ollama returned no response body for the download.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process all complete lines (split on newline; last element may be partial)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          // Skip lines that can't be parsed (e.g. keepalive noise).
          continue;
        }

        // Handle error lines.
        if (typeof parsed['error'] === 'string') {
          throw new Error(`Download failed: ${parsed['error']}`);
        }

        const status = typeof parsed['status'] === 'string' ? parsed['status'] : '';
        const completed = typeof parsed['completed'] === 'number' ? parsed['completed'] : undefined;
        const total = typeof parsed['total'] === 'number' ? parsed['total'] : undefined;

        let percent = 0;
        if (completed !== undefined && total !== undefined && total > 0) {
          percent = Math.min(100, Math.round((completed / total) * 100));
        }

        onProgress({ percent, status });

        if (status === 'success') {
          return;
        }
      }
    }

    // Flush any remaining buffer content.
    const remaining = buffer.trim();
    if (remaining) {
      try {
        const parsed = JSON.parse(remaining) as Record<string, unknown>;
        if (typeof parsed['error'] === 'string') {
          throw new Error(`Download failed: ${parsed['error']}`);
        }
        if (parsed['status'] === 'success') {
          return;
        }
      } catch (e) {
        // If it's our own error from above, re-throw it.
        if (e instanceof Error && e.message.startsWith('Download failed:')) throw e;
        // Otherwise ignore parse noise.
      }
    }

    // Stream ended without an explicit 'success' line — treat as complete
    // since Ollama sometimes omits the final status line on older versions.
  } finally {
    reader.releaseLock();
  }
}
