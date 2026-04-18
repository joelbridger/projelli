// AI Chat Store
// Global state management for AI chat conversations with persistence
//
// Q3 (Wave 1.2) — adds per-chat and per-day cost/token aggregation plus
// a per-day provider breakdown for the cost chip tooltip. The daily map
// is keyed by local-midnight YYYY-MM-DD so the "today" total resets
// naturally on day change without a timer. Only TODAY's bucket is
// exposed via `useTodayCost`; historical buckets are kept in case a
// later release surfaces a week/month summary, but the persist layer
// prunes anything older than 7 days to keep localStorage small.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { ChatMessage } from '@/types/ai';

export interface ChatCostEntry {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  /** Provider id ('anthropic' | 'openai' | 'google' | 'ollama'). */
  provider?: string;
}

/**
 * Per-day breakdown. `total` is the sum across all providers for the
 * day; `byProvider` is the cost split for the tooltip.
 */
export interface DailyCost {
  date: string; // YYYY-MM-DD
  total: number;
  inputTokens: number;
  outputTokens: number;
  byProvider: Record<string, number>;
}

export interface ChatSession {
  chatId: string;
  messages: ChatMessage[];
  isLoading: boolean;
  error?: string;
  lastUpdated: string;
  draftInput?: string; // Unsent message draft
  /** Q3 — rolling total for this chat session. */
  cost?: number;
  /** Q3 — rolling total input tokens for this chat session. */
  inputTokens?: number;
  /** Q3 — rolling total output tokens for this chat session. */
  outputTokens?: number;
}

interface AIChatStore {
  // State
  sessions: Record<string, ChatSession>;
  /** Q3 — daily cost buckets keyed by local YYYY-MM-DD. */
  dailyCosts: Record<string, DailyCost>;
  /**
   * M2 — per-chat "Ask my workspace" toggle. When `true`, every message
   * in that chat retrieves workspace context before the model is called.
   * Off by default; the user enables it per chat via the header toggle.
   */
  askWorkspaceMode: Record<string, boolean>;

  // Actions
  initSession: (chatId: string, initialMessages: ChatMessage[]) => void;
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateMessages: (chatId: string, messages: ChatMessage[]) => void;
  setLoading: (chatId: string, isLoading: boolean) => void;
  setError: (chatId: string, error?: string) => void;
  removeSession: (chatId: string) => void;
  clearAllSessions: () => void;
  updateLastMessage: (chatId: string, content: string) => void;
  setDraftInput: (chatId: string, draft: string) => void;
  clearDraftInput: (chatId: string) => void;
  /** M2 — set the Ask-my-workspace mode for a given chat. */
  setAskWorkspaceMode: (chatId: string, enabled: boolean) => void;
  /**
   * Q3 — Record the cost and token count of a single provider response.
   * Updates both the per-chat aggregate and today's daily bucket
   * (creating the bucket if it doesn't exist). Safe to call with zero
   * values; zero contributions are still counted so the caller doesn't
   * have to branch.
   */
  recordCost: (chatId: string, entry: ChatCostEntry) => void;
}

/**
 * Q3 — Local-date key (YYYY-MM-DD) for cost bucketing. Exported so
 * tests can freeze time via `vi.useFakeTimers()`.
 */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Q3 — Drop bucket entries older than this many days from the persisted
 * state. 7 days is plenty for the tooltip's "today" view; if a future
 * release wants a 30-day chart, the audit log is the source of truth
 * (see Q4 / CostMetrics.tsx).
 */
const DAILY_COST_RETENTION_DAYS = 7;

function pruneOldDailyCosts(
  dailyCosts: Record<string, DailyCost>,
  now: Date = new Date()
): Record<string, DailyCost> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - DAILY_COST_RETENTION_DAYS);
  const cutoffKey = todayKey(cutoff);
  const pruned: Record<string, DailyCost> = {};
  for (const [key, value] of Object.entries(dailyCosts)) {
    if (key >= cutoffKey) pruned[key] = value;
  }
  return pruned;
}

export const useAIChatStore = create<AIChatStore>()(
  persist(
    (set) => ({
      sessions: {},
      dailyCosts: {},
      askWorkspaceMode: {},

      initSession: (chatId, initialMessages) => {
        set((state) => {
          // Only initialize if session doesn't exist or is stale
          if (!state.sessions[chatId]) {
            return {
              sessions: {
                ...state.sessions,
                [chatId]: {
                  chatId,
                  messages: initialMessages,
                  isLoading: false,
                  lastUpdated: new Date().toISOString(),
                },
              },
            };
          }
          return state;
        });
      },

      addMessage: (chatId, message) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [chatId]: {
                ...session,
                messages: [...session.messages, message],
                lastUpdated: new Date().toISOString(),
              },
            },
          };
        });
      },

      updateMessages: (chatId, messages) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [chatId]: {
                ...session,
                messages,
                lastUpdated: new Date().toISOString(),
              },
            },
          };
        });
      },

      setLoading: (chatId, isLoading) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) return state;

          return {
            sessions: {
              ...state.sessions,
              [chatId]: {
                ...session,
                isLoading,
              },
            },
          };
        });
      },

      setError: (chatId, error) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) return state;

          // Build updated session conditionally based on error parameter
          const updatedSession: ChatSession = error !== undefined
            ? {
                ...session,
                error,
                isLoading: false,
              }
            : {
                chatId: session.chatId,
                messages: session.messages,
                isLoading: false,
                lastUpdated: session.lastUpdated,
                // Explicitly omit error field when clearing
              };

          return {
            sessions: {
              ...state.sessions,
              [chatId]: updatedSession,
            },
          };
        });
      },

      removeSession: (chatId) => {
        set((state) => {
          const { [chatId]: _removed, ...remainingSessions } = state.sessions;
          return { sessions: remainingSessions };
        });
      },

      clearAllSessions: () => {
        set({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
      },

      setAskWorkspaceMode: (chatId, enabled) => {
        set((state) => {
          if (!enabled) {
            // Shrink the map when turning off so we don't grow unbounded.
            const { [chatId]: _removed, ...rest } = state.askWorkspaceMode;
            return { askWorkspaceMode: rest };
          }
          return {
            askWorkspaceMode: {
              ...state.askWorkspaceMode,
              [chatId]: true,
            },
          };
        });
      },

      updateLastMessage: (chatId, content) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session || session.messages.length === 0) return state;

          const updatedMessages = [...session.messages];
          updatedMessages[updatedMessages.length - 1] = {
            ...updatedMessages[updatedMessages.length - 1]!,
            content,
          };

          return {
            sessions: {
              ...state.sessions,
              [chatId]: {
                ...session,
                messages: updatedMessages,
                lastUpdated: new Date().toISOString(),
              },
            },
          };
        });
      },

      setDraftInput: (chatId, draft) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) {
            // Create a minimal session to store the draft
            return {
              sessions: {
                ...state.sessions,
                [chatId]: {
                  chatId,
                  messages: [],
                  isLoading: false,
                  lastUpdated: new Date().toISOString(),
                  draftInput: draft,
                },
              },
            };
          }
          return {
            sessions: {
              ...state.sessions,
              [chatId]: {
                ...session,
                draftInput: draft,
              },
            },
          };
        });
      },

      clearDraftInput: (chatId) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) return state;

          const { draftInput: _, ...sessionWithoutDraft } = session;
          return {
            sessions: {
              ...state.sessions,
              [chatId]: sessionWithoutDraft as ChatSession,
            },
          };
        });
      },

      recordCost: (chatId, entry) => {
        set((state) => {
          // 1) Update per-chat aggregate (create a minimal session if the
          //    cost arrives before initSession — unlikely but safe).
          const existing = state.sessions[chatId];
          const nextSession: ChatSession = existing
            ? {
                ...existing,
                cost: (existing.cost ?? 0) + entry.cost,
                inputTokens: (existing.inputTokens ?? 0) + entry.inputTokens,
                outputTokens: (existing.outputTokens ?? 0) + entry.outputTokens,
                lastUpdated: new Date().toISOString(),
              }
            : {
                chatId,
                messages: [],
                isLoading: false,
                lastUpdated: new Date().toISOString(),
                cost: entry.cost,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
              };

          // 2) Update today's daily bucket.
          const key = todayKey();
          const prevDaily: DailyCost = state.dailyCosts[key] ?? {
            date: key,
            total: 0,
            inputTokens: 0,
            outputTokens: 0,
            byProvider: {},
          };
          const providerId = entry.provider ?? 'unknown';
          const byProvider = {
            ...prevDaily.byProvider,
            [providerId]: (prevDaily.byProvider[providerId] ?? 0) + entry.cost,
          };
          const nextDaily: DailyCost = {
            date: key,
            total: prevDaily.total + entry.cost,
            inputTokens: prevDaily.inputTokens + entry.inputTokens,
            outputTokens: prevDaily.outputTokens + entry.outputTokens,
            byProvider,
          };

          // 3) Prune older-than-retention buckets so localStorage stays small.
          const dailyCosts = pruneOldDailyCosts({
            ...state.dailyCosts,
            [key]: nextDaily,
          });

          return {
            sessions: {
              ...state.sessions,
              [chatId]: nextSession,
            },
            dailyCosts,
          };
        });
      },

    }),
    {
      name: 'ai-chat-storage', // localStorage key
      version: 4, // Bumped for M2 askWorkspaceMode
      migrate: (persisted: unknown, version: number) => {
        // Older versions lack `dailyCosts`; add an empty map so the
        // store shape stays consistent. We don't retroactively compute
        // costs for past chats — they'll start contributing from the
        // next response onwards.
        if (version < 3) {
          const next = (persisted ?? {}) as Partial<AIChatStore>;
          return {
            ...next,
            sessions: next.sessions ?? {},
            dailyCosts: {},
            askWorkspaceMode: {},
          };
        }
        if (version < 4) {
          const next = (persisted ?? {}) as Partial<AIChatStore>;
          return {
            ...next,
            sessions: next.sessions ?? {},
            dailyCosts: next.dailyCosts ?? {},
            askWorkspaceMode: {},
          };
        }
        return persisted as AIChatStore;
      },
    }
  )
);

// Helper function to get draft input (non-reactive)
export function getDraftInput(chatId: string): string {
  const session = useAIChatStore.getState().sessions[chatId];
  return session?.draftInput || '';
}

// ─────────────────────────────────────────────────────────────────────
// Q3 — cost selectors
// ─────────────────────────────────────────────────────────────────────

export interface ChatCostSummary {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Q3 — Subscribe to the running per-chat cost totals. Returns zero values
 * when no costs have been recorded yet (i.e. for chats created before
 * v1.5 or for the first turn of a new chat).
 */
export function useChatCost(chatId: string): ChatCostSummary {
  // useShallow: the selector returns a fresh object on every call, which
  // trips React's useSyncExternalStore identity check and causes an
  // infinite re-render loop when two ChatCostChip instances mount in the
  // same tree (e.g., Pop out creates a second AIChatViewer). Shallow
  // comparison treats equal-by-value objects as unchanged.
  return useAIChatStore(
    useShallow((s) => {
      const session = s.sessions[chatId];
      return {
        cost: session?.cost ?? 0,
        inputTokens: session?.inputTokens ?? 0,
        outputTokens: session?.outputTokens ?? 0,
      };
    }),
  );
}

export interface TodayCostSummary {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  byProvider: Record<string, number>;
}

/**
 * Q3 — Subscribe to today's cumulative cost across every chat. Zero-valued
 * when localStorage is empty or when today's bucket doesn't yet exist
 * (first response of the day will create it).
 */
// Stable empty byProvider map so the empty-bucket path doesn't produce
// a fresh `{}` on every selector call — shallow equality only checks
// the top-level keys, so a new inner `{}` would still trip the
// getSnapshot-should-be-cached warning and loop.
const EMPTY_BY_PROVIDER: Record<string, number> = {};

export function useTodayCost(): TodayCostSummary {
  // See useChatCost above for why useShallow is required.
  return useAIChatStore(
    useShallow((s) => {
      const key = todayKey();
      const bucket = s.dailyCosts[key];
      if (!bucket) {
        return { cost: 0, inputTokens: 0, outputTokens: 0, byProvider: EMPTY_BY_PROVIDER };
      }
      return {
        cost: bucket.total,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        byProvider: bucket.byProvider,
      };
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────
// M2 — Ask-my-workspace selector
// ─────────────────────────────────────────────────────────────────────

/**
 * M2 — Subscribe to the Ask-my-workspace toggle for a specific chat.
 * `false` when the chat has never flipped the toggle (the default).
 */
export function useAskWorkspaceMode(chatId: string): boolean {
  return useAIChatStore((s) => Boolean(s.askWorkspaceMode[chatId]));
}
