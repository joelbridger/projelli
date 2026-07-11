import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { useOfflineModeStore } from '@/platform/privacy/offlineMode';
import {
  egressFetch,
  egressFetchStream,
  getEgressStreamReader,
  OfflineModeBlockedError,
  UnregisteredEgressOperationError,
} from '@/platform/privacy/networkClient';

function nativeStatus(offlineMode: boolean, generation: number): void {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'network_policy_status') return { offlineMode, generation };
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe('networkClient', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockReset();
    useOfflineModeStore.setState({
      offlineMode: false,
      generation: 0,
      hydrated: false,
      isHydrating: false,
      hydrationError: null,
    });
  });

  it('fails loudly when a caller has no registered operation', async () => {
    await expect(
      egressFetch('unknown-operation', 'https://api.openai.com/v1/models')
    ).rejects.toBeInstanceOf(UnregisteredEgressOperationError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('uses the plain browser transport without policy checks outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    const response = new Response('{"ok":true}', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      egressFetch('cloud-ai', '/api/openai/v1/models')
    ).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/openai/v1/models', undefined);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('allows a registered destination while Offline Mode is off', async () => {
    nativeStatus(false, 3);
    const response = new Response('{"ok":true}', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      egressFetch('cloud-ai', 'https://api.openai.com/v1/models')
    ).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('blocks internet destinations with the stable Offline Mode error', async () => {
    nativeStatus(true, 4);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      egressFetch('cloud-ai', 'https://api.openai.com/v1/models')
    ).rejects.toMatchObject({
      name: 'OfflineModeBlockedError',
      code: 'OFFLINE_MODE_BLOCKED',
      message:
        'Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use cloud AI.',
    });
    await expect(
      egressFetch('cloud-ai', 'https://api.openai.com/v1/models')
    ).rejects.toBeInstanceOf(OfflineModeBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps literal loopback local AI available while Offline Mode is on', async () => {
    nativeStatus(true, 5);
    const response = new Response('', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      egressFetch(
        'local-loopback',
        'http://127.0.0.1:18089/v1/chat/completions'
      )
    ).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts in-flight work when the mirror receives a newer Offline Mode generation', async () => {
    nativeStatus(false, 10);
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(requestSignal?.reason),
          { once: true }
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = egressFetch(
      'cloud-ai',
      'https://api.openai.com/v1/chat/completions'
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    useOfflineModeStore.setState({
      offlineMode: true,
      generation: 11,
      hydrated: true,
    });

    await expect(request).rejects.toBeInstanceOf(OfflineModeBlockedError);
    expect(requestSignal?.aborted).toBe(true);
  });

  it('aborts a streaming body when Offline Mode flips after response headers', async () => {
    nativeStatus(false, 15);
    const encoder = new TextEncoder();
    let sourceController: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          sourceController = controller;
        },
      })
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const streamingResponse = await egressFetchStream(
      'cloud-ai',
      'https://api.openai.com/v1/chat/completions'
    );
    const reader = getEgressStreamReader(streamingResponse);
    sourceController!.enqueue(encoder.encode('first chunk'));
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: encoder.encode('first chunk'),
    });

    const pendingRead = reader.read();
    useOfflineModeStore.setState({
      offlineMode: true,
      generation: 16,
      hydrated: true,
    });

    await expect(pendingRead).rejects.toBeInstanceOf(OfflineModeBlockedError);
    await expect(reader.read()).rejects.toBeInstanceOf(OfflineModeBlockedError);
  });

  it('re-authorizes an allowed redirect before fetching its next hop', async () => {
    nativeStatus(false, 12);
    const redirected = new Response('', {
      status: 302,
      headers: { location: 'https://api.openai.com/v1/redirected' },
    });
    const finalResponse = new Response('{"ok":true}', { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirected)
      .mockResolvedValueOnce(finalResponse);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      egressFetch('cloud-ai', 'https://api.openai.com/v1/models')
    ).resolves.toBe(finalResponse);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(fetchMock.mock.calls[1][0]).toEqual(
      new URL('https://api.openai.com/v1/redirected')
    );
  });

  it('blocks an external redirect while Offline Mode is on before the second hop', async () => {
    let status = { offlineMode: false, generation: 20 };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'network_policy_status') return status;
      throw new Error(`Unexpected command: ${command}`);
    });
    const fetchMock = vi.fn().mockImplementation(async () => {
      status = { offlineMode: true, generation: 21 };
      return new Response('', {
        status: 302,
        headers: { location: 'https://example.com/steal' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      egressFetch('cloud-ai', 'https://api.openai.com/v1/models')
    ).rejects.toBeInstanceOf(OfflineModeBlockedError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('stops redirect loops after five hops', async () => {
    nativeStatus(false, 30);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'https://api.openai.com/v1/again' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      egressFetch('cloud-ai', 'https://api.openai.com/v1/models')
    ).rejects.toThrow('Too many redirects');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('polls native policy while a request is active and cancels after a policy flip', async () => {
    let status = { offlineMode: false, generation: 40 };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'network_policy_status') return status;
      throw new Error(`Unexpected command: ${command}`);
    });
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(requestSignal?.reason),
          {
            once: true,
          }
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = egressFetch(
      'cloud-ai',
      'https://api.openai.com/v1/chat/completions'
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    status = { offlineMode: true, generation: 41 };

    await expect(request).rejects.toBeInstanceOf(OfflineModeBlockedError);
    expect(requestSignal?.aborted).toBe(true);
  });
});
