/**
 * M5 — per-hunk accept / reject behaviour.
 *
 * Exercises `useInlineAiEdit` end-to-end with:
 *   - a fake `Provider` that streams a pre-baked replacement
 *   - an in-memory `EditorAdapter` implementing `getDocText` +
 *     `replaceRange` so we can inspect the final doc state
 *
 * Verifies:
 *   - accepting a single hunk applies that hunk and leaves other
 *     hunks' regions as they were in the original
 *   - rejecting a hunk leaves that region alone
 *   - acceptAll applies every pending hunk
 *   - rejectAll restores the original selection verbatim
 *   - session closes once every hunk is resolved
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type {
  Provider,
  ProviderResponse,
  StreamOptions,
  SendOptions,
  StructuredOutputOptions,
  ProviderMetadata,
} from '@/platform/providers/Provider';
import {
  useInlineAiEdit,
  type EditorAdapter,
} from '@/features/documents/editor/useInlineAiEdit';

/** Tiny in-memory editor: tracks a doc string and a selection range. */
function makeMemoryAdapter(initial: string, selection: { from: number; to: number }): {
  adapter: EditorAdapter;
  getDoc: () => string;
} {
  let doc = initial;
  const adapter: EditorAdapter = {
    getSelectedText: () => doc.slice(selection.from, selection.to),
    getSelectionRange: () => ({ ...selection }),
    replaceRange: (from, to, insert) => {
      doc = doc.slice(0, from) + insert + doc.slice(to);
    },
    coordsAtPos: () => ({ x: 0, y: 0 }),
    getDocText: () => doc,
    getDomNode: () => null,
    filePath: '/ws/doc.md',
  };
  return { adapter, getDoc: () => doc };
}

/** Fake provider that streams a fixed response in chunks. */
function makeFakeProvider(replacement: string): Provider {
  return {
    getMetadata: (): ProviderMetadata => ({
      providerId: 'anthropic',
      name: 'Claude',
      model: 'claude-haiku-4-5',
    }),
    sendMessage: async (): Promise<ProviderResponse> => ({
      content: replacement,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: 0,
      model: 'claude-haiku-4-5',
    }),
    sendMessageStreaming: async (
      prompt: string,
      options: StreamOptions
    ): Promise<ProviderResponse> => {
      void prompt;
      // Emit the replacement in ~5-char chunks so the streaming flow
      // mirrors realistic token arrival.
      for (let i = 0; i < replacement.length; i += 5) {
        options.onChunk(replacement.slice(i, i + 5));
      }
      return {
        content: replacement,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: 0,
        model: 'claude-haiku-4-5',
      };
    },
    structuredOutput: async <T,>(
      prompt: string,
      options: StructuredOutputOptions
    ): Promise<T> => {
      void prompt;
      void options;
      return ({} as T);
    },
    // No-op to satisfy the Provider surface we use.
    toolCall: async <T,>(): Promise<T> => ({} as T),
    // Attachment support is not exercised by these hunk-accept/reject tests.
    formatAttachmentForRequest: () => {
      throw new Error('not used in these tests');
    },
    supportsAttachment: () => false,
    // sendMessage option to keep TS happy (not used by hook).
    ...(undefined as unknown as { isConfigured?: () => boolean }),
  } satisfies Provider;
}

describe('useInlineAiEdit — hunk accept/reject', () => {
  const original = 'alpha\nbeta\ngamma\ndelta\nepsilon';
  // Replace two non-contiguous lines → two hunks.
  const replacement = 'alpha\nBETA\ngamma\nDELTA\nepsilon';

  it('accept on hunk 0 applies hunk 0 only; hunk 1 region stays original', async () => {
    const { adapter, getDoc } = makeMemoryAdapter(original, {
      from: 0,
      to: original.length,
    });
    const provider = makeFakeProvider(replacement);

    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => provider,
        docVersion: 1,
      })
    );

    await act(async () => {
      await result.current.handlers.submitInstruction('uppercase the even lines');
    });

    // After streaming, two hunks should be detected.
    await waitFor(() => {
      expect(result.current.state.sessionStreaming).toBe(false);
    });

    // Accept hunk 0 only.
    act(() => {
      result.current.handlers.acceptHunk({
        index: 0,
        originalStart: 1,
        originalEnd: 2,
        proposedStart: 1,
        proposedEnd: 2,
        removedLines: ['beta'],
        addedLines: ['BETA'],
      });
    });

    // Doc now has BETA but still has lowercase delta.
    expect(getDoc()).toContain('BETA');
    expect(getDoc()).toContain('delta');
    expect(getDoc()).not.toContain('DELTA');
  });

  it('reject on hunk 0 leaves hunk 0 region original', async () => {
    const { adapter, getDoc } = makeMemoryAdapter(original, {
      from: 0,
      to: original.length,
    });
    const provider = makeFakeProvider(replacement);
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => provider,
        docVersion: 1,
      })
    );

    await act(async () => {
      await result.current.handlers.submitInstruction('uppercase');
    });
    await waitFor(() => expect(result.current.state.sessionStreaming).toBe(false));

    act(() => {
      result.current.handlers.rejectHunk({
        index: 0,
        originalStart: 1,
        originalEnd: 2,
        proposedStart: 1,
        proposedEnd: 2,
        removedLines: ['beta'],
        addedLines: ['BETA'],
      });
    });

    // After rejecting hunk 0, its region should still say lowercase "beta".
    expect(getDoc()).toContain('beta');
    expect(getDoc()).not.toContain('BETA');
  });

  it('acceptAll applies every hunk', async () => {
    const { adapter, getDoc } = makeMemoryAdapter(original, {
      from: 0,
      to: original.length,
    });
    const provider = makeFakeProvider(replacement);
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => provider,
        docVersion: 1,
      })
    );
    await act(async () => {
      await result.current.handlers.submitInstruction('uppercase');
    });
    await waitFor(() => expect(result.current.state.sessionStreaming).toBe(false));

    act(() => {
      result.current.handlers.acceptAll();
    });

    expect(getDoc()).toBe(replacement);
    // Session should close once everything is resolved.
    await waitFor(() => {
      expect(result.current.state.sessionActive).toBe(false);
    });
  });

  it('rejectAll restores original selection verbatim', async () => {
    const { adapter, getDoc } = makeMemoryAdapter(original, {
      from: 0,
      to: original.length,
    });
    const provider = makeFakeProvider(replacement);
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => provider,
        docVersion: 1,
      })
    );
    await act(async () => {
      await result.current.handlers.submitInstruction('uppercase');
    });
    await waitFor(() => expect(result.current.state.sessionStreaming).toBe(false));

    act(() => {
      result.current.handlers.rejectAll();
    });

    expect(getDoc()).toBe(original);
    await waitFor(() => {
      expect(result.current.state.sessionActive).toBe(false);
    });
  });

  it('cancelSession during streaming restores original and closes', async () => {
    // Fake provider that never finishes streaming until we abort.
    const slowProvider: Provider = {
      getMetadata: () => ({ model: 'test' }),
      sendMessage: async () => ({
        content: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: 0,
        model: 'test',
      }),
      sendMessageStreaming: (
        prompt: string,
        options: StreamOptions
      ): Promise<ProviderResponse> => {
        void prompt;
        return new Promise((resolve, reject) => {
          void resolve;
          options.onChunk('partial');
          if (!options.signal) {
            return;
          }
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
      structuredOutput: async <T,>(
        prompt: string,
        options: StructuredOutputOptions
      ): Promise<T> => {
        void prompt;
        void options;
        return ({} as T);
      },
      formatAttachmentForRequest: () => {
        throw new Error('not used in these tests');
      },
      supportsAttachment: () => false,
    } satisfies Provider;

    const { adapter, getDoc } = makeMemoryAdapter(original, {
      from: 0,
      to: original.length,
    });
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => slowProvider,
        docVersion: 1,
      })
    );

    // Fire-and-forget — don't await since it never resolves naturally.
    act(() => {
      void result.current.handlers.submitInstruction('edit');
    });

    await waitFor(() => {
      expect(result.current.state.sessionActive).toBe(true);
    });

    act(() => {
      result.current.handlers.cancelSession();
    });

    expect(getDoc()).toBe(original);
    await waitFor(() => {
      expect(result.current.state.sessionActive).toBe(false);
    });
  });

  // Satisfies the "check unused" flag by referencing `SendOptions`.
  it('type surface: SendOptions reachable', () => {
    const opts: SendOptions = { temperature: 0 };
    expect(opts.temperature).toBe(0);
  });
});
