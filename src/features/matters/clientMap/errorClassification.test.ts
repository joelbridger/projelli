// src/features/matters/clientMap/errorClassification.test.ts
import { describe, expect, it } from 'vitest';
import { ProviderError } from '@/platform/providers/Provider';
import {
  classifyClientMapError,
  clientMapBuildErrorMessage,
  clientMapUpdateErrorMessage,
} from './errorClassification';

describe('classifyClientMapError', () => {
  it('classifies the RAG retrieval-integrity refusal as an index error', () => {
    const error = new Error(
      'memory integrity is uncertain (the safety record could not be read); re-index this workspace before searching',
    );
    expect(classifyClientMapError(error)).toBe('index');
  });

  it('classifies a plain re-index-worded string error as an index error', () => {
    expect(classifyClientMapError('please re-index this workspace')).toBe('index');
  });

  it('classifies the browser no-backend retrieval throw as an index error', () => {
    expect(classifyClientMapError(new Error('RAG is only available in the desktop app.'))).toBe(
      'index',
    );
  });

  it('classifies a still-downloading embedding model (model-not-ready) as an index error', () => {
    // Mirrors the marker rag_retrieve preserves across its anyhow chain
    // (src-tauri/src/commands/rag/query.rs) so the frontend can route on it,
    // same as refusalKeyForReason in src/features/ask/AIChatViewer.tsx.
    expect(classifyClientMapError(new Error('embed query: model-not-ready: eng model missing'))).toBe(
      'index',
    );
  });

  it('classifies a raw string rejection (as Tauri invoke actually rejects with) as an index error', () => {
    expect(classifyClientMapError('embed query: model-not-ready')).toBe('index');
  });

  it('classifies a LanceDB nearest-neighbor query failure as an index error', () => {
    expect(classifyClientMapError(new Error('nearest: table scan failed'))).toBe('index');
  });

  it('classifies a local vector-store open failure as an index error', () => {
    expect(classifyClientMapError(new Error('open lancedb: permission denied'))).toBe('index');
  });

  it('classifies a table-listing failure as an index error', () => {
    expect(classifyClientMapError(new Error('list tables: connection reset'))).toBe('index');
  });

  it('classifies a chunks-table open failure as an index error', () => {
    expect(classifyClientMapError(new Error('open table: schema mismatch'))).toBe('index');
  });

  it('does not classify an internal scope bug as an index error', () => {
    // A caller passing a bad matterId isn't fixed by re-indexing — it should
    // fall through to 'unknown' rather than send the user on a wild goose chase.
    expect(classifyClientMapError(new Error('invalid scope matter_id: not-a-uuid'))).toBe('unknown');
  });

  it('classifies a typed ProviderError as a provider error', () => {
    const error = new ProviderError('boom', 'api_error', 500, false);
    expect(classifyClientMapError(error)).toBe('provider');
  });

  it('classifies a Claude API error string as a provider error', () => {
    expect(classifyClientMapError(new Error('Claude API error: HTTP 401 — invalid x-api-key'))).toBe(
      'provider',
    );
  });

  it('classifies an OpenAI API error string as a provider error', () => {
    expect(classifyClientMapError(new Error('OpenAI API error: HTTP 429 — rate limited'))).toBe(
      'provider',
    );
  });

  it('classifies a network failure as a provider error', () => {
    expect(classifyClientMapError(new TypeError('Failed to fetch'))).toBe('provider');
  });

  it("classifies ClaudeProvider's wrapped network-error message as a provider error", () => {
    expect(
      classifyClientMapError(
        new Error('Network error: Unable to connect to Claude API. Please check your internet connection.'),
      ),
    ).toBe('provider');
  });

  it("classifies ClaudeProvider's dev-mode CORS error as a provider error", () => {
    expect(
      classifyClientMapError(
        new Error("CORS Error: You're accessing the app on port 3000. For AI features to work, run \"npm run dev\"."),
      ),
    ).toBe('provider');
  });

  it('classifies an unrecognized error as unknown', () => {
    expect(classifyClientMapError(new Error('something exploded'))).toBe('unknown');
  });

  it('classifies a non-Error thrown value with no message as unknown', () => {
    expect(classifyClientMapError({ weird: true })).toBe('unknown');
  });
});

describe('clientMapBuildErrorMessage', () => {
  it('names the real problem for an index/retrieval failure', () => {
    const error = new Error('memory integrity is uncertain; re-index this workspace before searching');
    expect(clientMapBuildErrorMessage(error)).toMatch(/rebuild|re-index/i);
    expect(clientMapBuildErrorMessage(error)).not.toMatch(/AI connection/i);
  });

  it('keeps the existing AI-connection message for a provider failure', () => {
    const error = new Error('Claude API error: HTTP 500 — internal error');
    expect(clientMapBuildErrorMessage(error)).toBe(
      'Could not build client map. Check your AI connection and try again.',
    );
  });

  it('does not blame the AI connection for an unclassified failure', () => {
    const error = new Error('unexpected failure');
    const message = clientMapBuildErrorMessage(error);
    expect(message).not.toMatch(/AI connection/i);
    expect(message).toBe('Could not build client map. Try again in a moment.');
  });
});

describe('clientMapUpdateErrorMessage', () => {
  it('names the real problem for an index/retrieval failure', () => {
    const error = new Error('memory integrity is uncertain; re-index this workspace before searching');
    expect(clientMapUpdateErrorMessage(error)).toMatch(/rebuild|re-index/i);
  });

  it('keeps the existing generic message for a provider failure (never blamed AI)', () => {
    const error = new Error('Claude API error: HTTP 500 — internal error');
    expect(clientMapUpdateErrorMessage(error)).toBe(
      'Could not check for client map updates. Try again in a moment.',
    );
  });

  it('keeps the existing generic message for an unclassified failure', () => {
    const error = new Error('unexpected failure');
    expect(clientMapUpdateErrorMessage(error)).toBe(
      'Could not check for client map updates. Try again in a moment.',
    );
  });
});
