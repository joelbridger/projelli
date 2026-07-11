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
});
