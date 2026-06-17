// File Context Store
//
// Tracks the AI-visible "ambient" context derived from each open tab. This is
// the backbone of Keepance's "like Cursor but for docs" moment: open a file
// and it's automatically in the AI's system prompt unless the user opts out.
//
// Why a separate store (not `aiChatStore` or `editorStore`)?
//  - `aiChatStore` holds chat sessions and is persisted at full content
//    fidelity; extracted contexts are derived state, best kept out of there.
//  - `editorStore` owns tab layout. Layering file-context logic on top of it
//    makes tab operations more expensive (and subscribes every consumer of
//    tab state to extraction changes).
//
// Persistence strategy:
//  - `contexts` lives ONLY in memory. It's re-extracted on tab open so stale
//    snapshots never outlive a session, and the Zustand persist middleware
//    doesn't have to serialize hundreds of KB of text into localStorage.
//  - `disabledPaths` IS persisted so the user's per-file opt-out preference
//    survives reloads. We intentionally keep this as a simple bag of paths
//    rather than a richer object — there's only one piece of state to track.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ExtractedContext } from '@/utils/ai-file-context';

interface FileContextState {
  /** In-memory extracted context per tab path. NOT persisted. */
  contexts: Record<string, ExtractedContext>;
  /** Paths the user has explicitly toggled off. Persisted. */
  disabledPaths: Record<string, true>;

  setContext: (path: string, context: ExtractedContext) => void;
  removeContext: (path: string) => void;
  togglePath: (path: string) => void;
  isEnabled: (path: string) => boolean;
  hasContext: (path: string) => boolean;
  getContext: (path: string) => ExtractedContext | undefined;
  getActiveContexts: () => ExtractedContext[];
}

export const useFileContextStore = create<FileContextState>()(
  persist(
    (set, get) => ({
      contexts: {},
      disabledPaths: {},

      setContext: (path, context) => {
        set((state) => ({
          contexts: { ...state.contexts, [path]: context },
        }));
      },

      removeContext: (path) => {
        set((state) => {
          if (!(path in state.contexts)) {
            return state;
          }
          const next = { ...state.contexts };
          delete next[path];
          return { contexts: next };
        });
      },

      togglePath: (path) => {
        set((state) => {
          const next = { ...state.disabledPaths };
          if (next[path]) {
            delete next[path];
          } else {
            next[path] = true;
          }
          return { disabledPaths: next };
        });
      },

      isEnabled: (path) => {
        return !get().disabledPaths[path];
      },

      hasContext: (path) => {
        return path in get().contexts;
      },

      getContext: (path) => {
        return get().contexts[path];
      },

      getActiveContexts: () => {
        const { contexts, disabledPaths } = get();
        const result: ExtractedContext[] = [];
        for (const [path, ctx] of Object.entries(contexts)) {
          if (!disabledPaths[path]) {
            result.push(ctx);
          }
        }
        return result;
      },
    }),
    {
      name: 'file-context-storage',
      version: 1,
      // Persist ONLY the disabled-paths set. Extracted contents are derived
      // state and can (and should) be regenerated on tab open.
      partialize: (state) => ({ disabledPaths: state.disabledPaths }),
    }
  )
);
