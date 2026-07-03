/**
 * F2.5 — file-access consent lives in the chat store, keyed per conversation.
 *
 * Locks: default OFF (unasked), grant persists per chat, null/unasked resets
 * (shrinks the map), and a different chatId is independent (new conversation
 * re-asks).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAIChatStore, getFileAccessConsent } from '@/platform/state/aiChatStore';

describe('aiChatStore.fileAccessConsent', () => {
  beforeEach(() => {
    useAIChatStore.getState().clearAllSessions();
  });

  it('defaults to unasked for an unknown conversation', () => {
    expect(getFileAccessConsent('chat-x')).toEqual({ state: 'unasked' });
  });

  it('records a grant per conversation and remembers it', () => {
    useAIChatStore.getState().setFileAccessConsent('chat-a', {
      state: 'granted',
      grantedScope: { kind: 'matter', matterId: 'client-A' },
    });
    expect(getFileAccessConsent('chat-a')).toEqual({ state: 'granted', grantedScope: { kind: 'matter', matterId: 'client-A' } });
    // A different conversation is independent (re-asks).
    expect(getFileAccessConsent('chat-b')).toEqual({ state: 'unasked' });
  });

  it('records a denial', () => {
    useAIChatStore.getState().setFileAccessConsent('chat-a', { state: 'denied' });
    expect(getFileAccessConsent('chat-a')).toEqual({ state: 'denied' });
  });

  it('null resets to unasked and shrinks the map', () => {
    useAIChatStore.getState().setFileAccessConsent('chat-a', { state: 'granted', grantedScope: { kind: 'allMatters' } });
    useAIChatStore.getState().setFileAccessConsent('chat-a', null);
    expect(getFileAccessConsent('chat-a')).toEqual({ state: 'unasked' });
    expect(useAIChatStore.getState().fileAccessConsent['chat-a']).toBeUndefined();
  });

  it('setting state:unasked also shrinks the map (no sentinel stored)', () => {
    useAIChatStore.getState().setFileAccessConsent('chat-a', { state: 'granted', grantedScope: { kind: 'matter', matterId: 'client-A' } });
    useAIChatStore.getState().setFileAccessConsent('chat-a', { state: 'unasked' });
    expect(useAIChatStore.getState().fileAccessConsent['chat-a']).toBeUndefined();
  });

  it('clearAllSessions wipes consent', () => {
    useAIChatStore.getState().setFileAccessConsent('chat-a', { state: 'granted', grantedScope: { kind: 'matter', matterId: 'client-A' } });
    useAIChatStore.getState().clearAllSessions();
    expect(getFileAccessConsent('chat-a')).toEqual({ state: 'unasked' });
  });

  it('a workspace-scoped chatId isolates consent per workspace (F2.5b root-scoping)', () => {
    // The Ask surface keys the conversation by `ask-...::<root>`, so a grant in
    // one workspace is stored under a different key than another workspace's.
    useAIChatStore.getState().setFileAccessConsent('ask-global::/ws/A', { state: 'granted', grantedScope: { kind: 'allMatters' } });
    expect(getFileAccessConsent('ask-global::/ws/A')).toEqual({ state: 'granted', grantedScope: { kind: 'allMatters' } });
    // Opening a different workspace looks up a DIFFERENT key → re-asks.
    expect(getFileAccessConsent('ask-global::/ws/B')).toEqual({ state: 'unasked' });
  });
});
