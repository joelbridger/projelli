import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  claudeCtor: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageStreaming: vi.fn(),
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    constructor(cfg: unknown) { mocks.claudeCtor(cfg); }
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = mocks.sendMessageStreaming;
    getMetadata() { return { model: 'stub' }; }
  },
}));

vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = mocks.sendMessageStreaming;
    getMetadata() { return { model: 'stub' }; }
  },
}));

vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = mocks.sendMessageStreaming;
    getMetadata() { return { model: 'stub' }; }
  },
}));

vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

vi.mock('@/platform/firm/resolveAssuredRoute', () => ({
  isAssuredProvider: (provider: string) => ['anthropic', 'openai', 'google'].includes(provider),
  resolveAssuredRoute: vi.fn((provider: 'anthropic', model: string, stream = true) => ({
    provider,
    model,
    accessToken: 'ACCESS',
    seatToken: 'SEAT',
    stream,
  })),
}));

import { AIChatViewer, type APIKey } from '@/features/ask/AIChatViewer';
import { buildAssuredRequest, type AssuredRoute } from '@/platform/firm/assuredInference';
import { resolveAssuredRoute } from '@/platform/firm/resolveAssuredRoute';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { AIChatFile } from '@/platform/types/ai';

const apiKeys: APIKey[] = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];

function makeChat(id: string): AIChatFile {
  return {
    id,
    title: 'Assured stream flag',
    created: '2026-06-22T00:00:00.000Z',
    updated: '2026-06-22T00:00:00.000Z',
    messages: [],
    provider: 'anthropic',
    model: 'stub-model',
  };
}

function workspaceService(): React.MutableRefObject<WorkspaceService | null> {
  return {
    current: {
      exists: vi.fn(async () => false),
      readFile: vi.fn(),
      getBackend: vi.fn(() => null),
    } as unknown as WorkspaceService,
  };
}

async function send(chat: AIChatFile, options: {
  workspace?: React.MutableRefObject<WorkspaceService | null>;
  rootPath?: string;
} = {}) {
  render(
    <AIChatViewer
      chatData={chat}
      apiKeys={apiKeys}
      workspaceServiceRef={options.workspace}
      rootPath={options.rootPath}
    />,
  );
  act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Summarize this.' } }));
  act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
}

function assuredHeaderFromLastRouteResolve(): string {
  const mockedResolve = vi.mocked(resolveAssuredRoute);
  const call = mockedResolve.mock.lastCall as [string, string, boolean?] | undefined;
  expect(call).toBeDefined();
  const [provider, model, stream = true] = call!;
  const route = {
    provider,
    model,
    accessToken: 'ACCESS',
    seatToken: 'SEAT',
    stream,
  } as AssuredRoute;
  return buildAssuredRequest(route, { 'Content-Type': 'application/json' }).headers['X-Stream']!;
}

describe('Assured chat stream flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
    mocks.sendMessage.mockResolvedValue({
      content: 'Done.',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'stub-model',
    });
    mocks.sendMessageStreaming.mockImplementation(async (_prompt: string, opts: { onChunk: (chunk: string) => void }) => {
      opts.onChunk('Done.');
      return {
        content: 'Done.',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cost: 0,
        model: 'stub-model',
      };
    });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('sets X-Stream to 0 when workspace tools force the non-streaming path', async () => {
    await send(makeChat('assured-non-stream'), {
      workspace: workspaceService(),
      rootPath: '/ws',
    });

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendMessageStreaming).not.toHaveBeenCalled();
    expect(assuredHeaderFromLastRouteResolve()).toBe('0');
  });

  it('sets X-Stream to 1 for the streaming path', async () => {
    await send(makeChat('assured-stream'));

    await waitFor(() => expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(assuredHeaderFromLastRouteResolve()).toBe('1');
  });
});
