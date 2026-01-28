// AI Chat Store
// Global state management for AI chat conversations with persistence

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage } from '@/types/ai';

export interface ChatSession {
  chatId: string;
  messages: ChatMessage[];
  isLoading: boolean;
  error?: string;
  lastUpdated: string;
}

interface AIChatStore {
  // State
  sessions: Record<string, ChatSession>;

  // Actions
  initSession: (chatId: string, initialMessages: ChatMessage[]) => void;
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateMessages: (chatId: string, messages: ChatMessage[]) => void;
  setLoading: (chatId: string, isLoading: boolean) => void;
  setError: (chatId: string, error?: string) => void;
  removeSession: (chatId: string) => void;
  clearAllSessions: () => void;
}

export const useAIChatStore = create<AIChatStore>()(
  persist(
    (set) => ({
      sessions: {},

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
          const { [chatId]: removed, ...remainingSessions } = state.sessions;
          return { sessions: remainingSessions };
        });
      },

      clearAllSessions: () => {
        set({ sessions: {} });
      },
    }),
    {
      name: 'ai-chat-storage', // localStorage key
      version: 1,
    }
  )
);
