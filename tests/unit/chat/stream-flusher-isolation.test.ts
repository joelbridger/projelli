/**
 * Perf (P1.2) fix — Codex review round 4 (P1): two concurrent streams must
 * never share buffer/frame state.
 *
 * `AIChatViewer`'s local streaming-preview state survives a `chatId` prop
 * change (MainPanel reuses the same instance across open chats), so if the
 * user switches chats and sends again before the first turn's stream
 * finishes, TWO overlapping `handleSendMessage` invocations exist at once.
 * The original implementation used a single hook-level ref pair
 * (`streamBufferRef`/`streamRafRef`) shared by every call — a late chunk
 * from the old turn could overwrite the new turn's buffered text just
 * before its already-scheduled flush fired, publishing the WRONG chat's
 * content tagged with the RIGHT chat's id: a real leak even with the
 * per-chat tagging from the previous fix.
 *
 * `createStreamFlusher(chatId, setPreview)` is called fresh per turn and
 * closes over its own private `buffer`/`rafId` — this drives it directly
 * (mocking rAF for full determinism, no timing flakiness) to prove two
 * flushers never see each other's state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStreamFlusher } from '@/features/ask/hooks/useChatSending';

describe('createStreamFlusher — no cross-turn state sharing (Perf P1.2, Codex P1)', () => {
  let pendingFrames: Array<() => void>;
  let nextFrameId: number;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pendingFrames = [];
    nextFrameId = 1;
    // Fully deterministic rAF: capture the callback instead of scheduling it
    // on a real frame, so the test controls exactly when (and in what
    // order) each flusher's frame "fires".
    rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames[id] = () => cb(0);
      return id;
    });
    cafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
      delete pendingFrames[id];
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  function fireFrame(id: number) {
    const cb = pendingFrames[id];
    delete pendingFrames[id];
    cb?.();
  }

  it('interleaved turns for two different chats never cross-contaminate content or tag', () => {
    const setPreview = vi.fn();
    const flusherA = createStreamFlusher('chat-a', setPreview);
    const flusherB = createStreamFlusher('chat-b', setPreview);

    // A's first chunk schedules frame #1.
    flusherA.push('A1');
    expect(pendingFrames[1]).toBeDefined();
    fireFrame(1);
    expect(setPreview).toHaveBeenLastCalledWith({ chatId: 'chat-a', content: 'A1' });

    // B's first chunk schedules its OWN frame (#2) — A's frame already fired.
    flusherB.push('B1');
    expect(pendingFrames[2]).toBeDefined();

    // A gets a LATE chunk BEFORE B's frame fires. Since A's own rafId is
    // null (frame #1 already fired and cleared it), this schedules A's own
    // NEW frame (#3) — it must NOT see or reuse B's pending frame #2.
    flusherA.push('A1A2');
    expect(pendingFrames[3]).toBeDefined();

    // Fire B's frame (#2): must publish B's own buffer, untouched by A's
    // later push — this is exactly the scenario that leaked before the fix
    // (a shared buffer would have already been overwritten to 'A1A2' by
    // the line above, and B's frame would have published someone else's
    // confidential text tagged as chat-b).
    fireFrame(2);
    expect(setPreview).toHaveBeenLastCalledWith({ chatId: 'chat-b', content: 'B1' });

    // Fire A's frame (#3): must publish A's own accumulated buffer.
    fireFrame(3);
    expect(setPreview).toHaveBeenLastCalledWith({ chatId: 'chat-a', content: 'A1A2' });

    // No call ever mixed A's content under B's tag or vice versa.
    for (const call of setPreview.mock.calls) {
      const [preview] = call as [{ chatId: string; content: string }];
      if (preview.chatId === 'chat-a') expect(preview.content.startsWith('A')).toBe(true);
      if (preview.chatId === 'chat-b') expect(preview.content.startsWith('B')).toBe(true);
    }
  });

  it('finish() only clears the preview if it still belongs to the finishing turn', () => {
    let preview: { chatId: string; content: string } | null = null;
    const setPreview = vi.fn((update: unknown) => {
      preview = typeof update === 'function'
        ? (update as (prev: typeof preview) => typeof preview)(preview)
        : (update as typeof preview);
    });

    const flusherA = createStreamFlusher('chat-a', setPreview);
    const flusherB = createStreamFlusher('chat-b', setPreview);

    flusherA.flushNow('A done streaming');
    expect(preview).toEqual({ chatId: 'chat-a', content: 'A done streaming' });

    // B is a DIFFERENT, still-in-flight turn — A finishing must not wipe it.
    flusherB.flushNow('B still streaming');
    expect(preview).toEqual({ chatId: 'chat-b', content: 'B still streaming' });

    flusherA.finish();
    // A's finish() must be a no-op here: the live preview belongs to B now.
    expect(preview).toEqual({ chatId: 'chat-b', content: 'B still streaming' });

    flusherB.finish();
    expect(preview).toBeNull();
  });
});
