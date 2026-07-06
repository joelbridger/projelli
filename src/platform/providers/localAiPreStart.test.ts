// Fix 1a (demo readiness) — pre-start the llama-server sidecar as soon as the
// user signals intent to use local AI, instead of waiting for the first
// question to discover it isn't running yet.

import { afterEach, describe, expect, it, vi } from 'vitest';

const isEmbeddedLocalModelReadyMock = vi.fn();
vi.mock('./resolveLocalProvider', () => ({
  isEmbeddedLocalModelReady: (): unknown => isEmbeddedLocalModelReadyMock(),
}));

const localLlmSidecarStartMock = vi.fn();
vi.mock('@/platform/utils/tauri-commands', () => ({
  localLlmSidecarStart: (): unknown => localLlmSidecarStartMock(),
}));

import { preStartLocalAi, resetLocalAiPreStartForTests } from './localAiPreStart';

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  isEmbeddedLocalModelReadyMock.mockReset();
  localLlmSidecarStartMock.mockReset();
  resetLocalAiPreStartForTests();
});

describe('preStartLocalAi', () => {
  it('starts the sidecar when the embedded model is ready', async () => {
    isEmbeddedLocalModelReadyMock.mockResolvedValue(true);
    localLlmSidecarStartMock.mockResolvedValue('http://127.0.0.1:18089');

    preStartLocalAi();
    await flushMicrotasks();

    expect(localLlmSidecarStartMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the embedded model is not downloaded yet', async () => {
    isEmbeddedLocalModelReadyMock.mockResolvedValue(false);

    preStartLocalAi();
    await flushMicrotasks();

    expect(localLlmSidecarStartMock).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls into a single in-flight start', async () => {
    isEmbeddedLocalModelReadyMock.mockResolvedValue(true);
    let resolveStart: (v: string) => void = () => undefined;
    localLlmSidecarStartMock.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );

    preStartLocalAi();
    preStartLocalAi();
    preStartLocalAi();
    await flushMicrotasks();
    resolveStart('http://127.0.0.1:18089');
    await flushMicrotasks();

    expect(localLlmSidecarStartMock).toHaveBeenCalledTimes(1);
  });

  it('swallows a start failure and allows a later retry', async () => {
    isEmbeddedLocalModelReadyMock.mockResolvedValue(true);
    localLlmSidecarStartMock.mockRejectedValueOnce(new Error('binary missing'));

    expect(() => { preStartLocalAi(); }).not.toThrow();
    await flushMicrotasks();
    expect(localLlmSidecarStartMock).toHaveBeenCalledTimes(1);

    localLlmSidecarStartMock.mockResolvedValueOnce('http://127.0.0.1:18089');
    preStartLocalAi();
    await flushMicrotasks();
    expect(localLlmSidecarStartMock).toHaveBeenCalledTimes(2);
  });
});
