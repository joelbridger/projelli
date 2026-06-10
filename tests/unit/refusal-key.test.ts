// Task 6 (Option B model download) — refusal-key routing for failed workspace
// retrieval. The model-not-ready case (embedding model still downloading on
// first run) must get its own honest refusal key instead of the generic
// search-failed text.

import { describe, expect, it } from 'vitest';
import { refusalKeyForReason } from '@/components/ai/AIChatViewer';

describe('refusalKeyForReason', () => {
  it('routes model-not-ready errors to the download-specific refusal', () => {
    expect(
      refusalKeyForReason('model-not-ready: indexing deferred until the model downloads'),
    ).toBe('ai.chat.model-not-ready-refuse');
  });

  it('routes a wrapped IPC error chain containing the marker', () => {
    // Mirrors the Rust `{e:#}` full-chain formatting crossing IPC, e.g.
    // "embed query: model-not-ready: the search model is not downloaded yet".
    expect(
      refusalKeyForReason('embed query: model-not-ready: the search model is not downloaded yet'),
    ).toBe('ai.chat.model-not-ready-refuse');
  });

  it('routes other failures to the generic refusal', () => {
    expect(refusalKeyForReason('lance dataset panic')).toBe(
      'ai.chat.retrieval-failed-refuse',
    );
    expect(refusalKeyForReason(undefined)).toBe(
      'ai.chat.retrieval-failed-refuse',
    );
    expect(refusalKeyForReason(null)).toBe(
      'ai.chat.retrieval-failed-refuse',
    );
  });

  it('stringifies Error objects so a thrown Error still routes', () => {
    expect(
      refusalKeyForReason(new Error('model-not-ready: the search model is not downloaded yet')),
    ).toBe('ai.chat.model-not-ready-refuse');
    expect(refusalKeyForReason(new Error('network unreachable'))).toBe(
      'ai.chat.retrieval-failed-refuse',
    );
  });
});
