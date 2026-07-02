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
import type { ChatMessage } from '@/platform/types/ai';
import {
  UNASKED_CONSENT,
  type FileAccessConsent,
} from '@/platform/ai/fileAccessConsent';

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
  /**
   * Ask/Search sessions are local to a workspace. This keeps old questions
   * from one client demo or test workspace from appearing in another one.
   */
  workspaceRoot?: string;
  draftInput?: string; // Unsent message draft
  /** Q3 — rolling total for this chat session. */
  cost?: number;
  /** Q3 — rolling total input tokens for this chat session. */
  inputTokens?: number;
  /** Q3 — rolling total output tokens for this chat session. */
  outputTokens?: number;
  /**
   * D1 — optional folder scope for this chat. When set, the AI context is
   * restricted to files whose path starts with this folder prefix. Also
   * restricts workspace search retrieval to files within this folder.
   * `null` (or absent) means "all open files — no scope".
   */
  scopedFolder?: string | null;
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
  /**
   * F2.5 — per-conversation consent for the AI's READ-class file tools with
   * CLOUD providers ("reading is sending"). Absent → treated as `unasked`
   * (default OFF). Keyed by chatId so a new conversation re-asks; a grant is
   * remembered for the life of the conversation (not a nag). See
   * [[fileAccessConsent]] for the decision logic the send path applies.
   */
  fileAccessConsent: Record<string, FileAccessConsent>;

  // Actions
  initSession: (chatId: string, initialMessages: ChatMessage[]) => void;
  setSessionWorkspaceRoot: (chatId: string, workspaceRoot: string | null) => void;
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
   * F2.5 — set (or clear) the file-access consent for a conversation. Pass
   * `null` to reset to `unasked` (shrinks the map). The scope a grant was made
   * under is carried on the consent object so an all-clients turn can require a
   * fresh confirm.
   */
  setFileAccessConsent: (chatId: string, consent: FileAccessConsent | null) => void;
  /**
   * D1 — set the folder scope for a given chat. Pass `null` to clear the
   * scope (revert to "all open files"). The value is the top-level folder
   * name relative to the workspace root (e.g. "Acme Corp"), not the full
   * absolute path. AIChatViewer resolves it to a full path prefix at call
   * time using the current rootPath prop.
   */
  setScopedFolder: (chatId: string, folder: string | null) => void;
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
 * state. Extended to 31 days so the store can answer "this month" and
 * "last 7 days" queries directly without touching the audit log.
 */
const DAILY_COST_RETENTION_DAYS = 31;

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
      fileAccessConsent: {},

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

      setSessionWorkspaceRoot: (chatId, workspaceRoot) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) return state;
          if ((session.workspaceRoot ?? null) === workspaceRoot) return state;

          const nextSession: ChatSession = workspaceRoot !== null
            ? {
                ...session,
                workspaceRoot,
                lastUpdated: new Date().toISOString(),
              }
            : (() => {
                const { workspaceRoot: _workspaceRoot, ...rest } = session;
                return {
                  ...rest,
                  lastUpdated: new Date().toISOString(),
                };
              })();

          return {
            sessions: {
              ...state.sessions,
              [chatId]: nextSession,
            },
          };
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
        set({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {}, fileAccessConsent: {} });
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

      setFileAccessConsent: (chatId, consent) => {
        set((state) => {
          if (consent === null || consent.state === 'unasked') {
            // Reset to default — shrink the map rather than store an
            // 'unasked' sentinel (absent === unasked at read time).
            const { [chatId]: _removed, ...rest } = state.fileAccessConsent;
            return { fileAccessConsent: rest };
          }
          return {
            fileAccessConsent: {
              ...state.fileAccessConsent,
              [chatId]: consent,
            },
          };
        });
      },

      setScopedFolder: (chatId, folder) => {
        set((state) => {
          const session = state.sessions[chatId];
          if (!session) {
            // Create a minimal session to hold the scope so it persists even
            // before the first message is sent.
            return {
              sessions: {
                ...state.sessions,
                [chatId]: {
                  chatId,
                  messages: [],
                  isLoading: false,
                  lastUpdated: new Date().toISOString(),
                  scopedFolder: folder,
                },
              },
            };
          }
          return {
            sessions: {
              ...state.sessions,
              [chatId]: {
                ...session,
                scopedFolder: folder,
              },
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
      version: 6, // Bumped for F2.5 fileAccessConsent map
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
        // v4 -> v5: scopedFolder added to ChatSession — existing sessions simply
        // won't have the field, which is fine (absent = no scope, same as null).
        // v5 -> v6: fileAccessConsent map added. Absent → every existing
        // conversation starts `unasked` (default OFF), which is the safe
        // fail-closed default — an old chat must re-confirm file access.
        if (version < 6) {
          const next = (persisted ?? {}) as Partial<AIChatStore>;
          return {
            ...next,
            sessions: next.sessions ?? {},
            dailyCosts: next.dailyCosts ?? {},
            askWorkspaceMode: next.askWorkspaceMode ?? {},
            fileAccessConsent: {},
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
// F1 — week / month cost selectors (Workstream F, Phase 1)
// ─────────────────────────────────────────────────────────────────────

export interface PeriodCostSummary {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Return the YYYY-MM-DD key for `daysAgo` days before `now`.
 * Exported for test convenience.
 */
export function keyDaysAgo(daysAgo: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return todayKey(d);
}

/**
 * F1 — Sum all daily buckets that fall within the current calendar month
 * (local time). Returns zero when no data exists yet. Works from the
 * in-memory store — no audit log required.
 */
export function useThisMonthCost(now?: Date): PeriodCostSummary {
  return useAIChatStore(
    useShallow((s) => {
      const ref = now ?? new Date();
      const monthPrefix = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-`;
      let cost = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const [key, bucket] of Object.entries(s.dailyCosts)) {
        if (key.startsWith(monthPrefix)) {
          cost += bucket.total;
          inputTokens += bucket.inputTokens;
          outputTokens += bucket.outputTokens;
        }
      }
      return { cost, inputTokens, outputTokens };
    }),
  );
}

/**
 * F1 — Sum the rolling 7-day window (today minus 6 days through today,
 * inclusive). Returns zero when no data exists yet.
 */
export function useLast7DaysCost(now?: Date): PeriodCostSummary {
  return useAIChatStore(
    useShallow((s) => {
      const ref = now ?? new Date();
      const cutoff = keyDaysAgo(6, ref); // 6 days ago = 7-day window inclusive
      let cost = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const [key, bucket] of Object.entries(s.dailyCosts)) {
        if (key >= cutoff) {
          cost += bucket.total;
          inputTokens += bucket.inputTokens;
          outputTokens += bucket.outputTokens;
        }
      }
      return { cost, inputTokens, outputTokens };
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

// ─────────────────────────────────────────────────────────────────────
// F2.5 — file-access consent selector
// ─────────────────────────────────────────────────────────────────────

/**
 * F2.5 — Subscribe to a conversation's file-access consent. Returns the
 * shared `UNASKED_CONSENT` default when the chat has never answered the prompt
 * (absent === unasked), so the composer shows the affordance by default.
 */
export function useFileAccessConsent(chatId: string): FileAccessConsent {
  return useAIChatStore((s) => s.fileAccessConsent[chatId] ?? UNASKED_CONSENT);
}

/**
 * F2.5 — Non-reactive read of a conversation's file-access consent, for the
 * send path (which snapshots scope + consent at send time rather than
 * subscribing). Mirrors `getDraftInput`.
 */
export function getFileAccessConsent(chatId: string): FileAccessConsent {
  return useAIChatStore.getState().fileAccessConsent[chatId] ?? UNASKED_CONSENT;
}

// ─────────────────────────────────────────────────────────────────────
// D1 — scoped folder selector
// ─────────────────────────────────────────────────────────────────────

/**
 * D1 — Subscribe to the active folder scope for a specific chat.
 * Returns `null` when no scope is set (the default — all open files are
 * included in context). Returns the top-level folder name string when the
 * user has scoped the chat to a particular folder.
 */
export function useScopedFolder(chatId: string): string | null {
  return useAIChatStore(
    (s) => s.sessions[chatId]?.scopedFolder ?? null,
  );
}
