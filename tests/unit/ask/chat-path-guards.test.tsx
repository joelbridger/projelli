/**
 * F2.8 — workspace-boundary guard migration in useChatSending's file tools.
 *
 * The AI file tools (read/list/search/write/create/move/delete) used to build
 * their absolute path with a hand-rolled `${rootPath}/${rel}` template and gate
 * it with a raw `filePath.startsWith(rootPath)` check. That check was a
 * TAUTOLOGY — the joined path is literally `rootPath + "/" + rel`, so it ALWAYS
 * started with rootPath and NEVER rejected anything (the real workspace boundary
 * was only enforced downstream by PathValidator). On Windows the raw check could
 * also never be turned into a genuine boundary test by normalizing the join
 * alone, because rootPath carries native backslashes.
 *
 * The migration replaces every join with `workspacePath()` and every workspace
 * guard with `sameOrInside(rootPath, …)` — a real, separator- and case-correct
 * boundary check at the tool layer. These tests drive the ACTUAL tool executor
 * (captured through the provider's setTools) with POSIX, Windows drive-letter,
 * and UNC roots to prove:
 *   - an in-workspace path is allowed and reaches the FS with a cleanly
 *     normalized (forward-slash) absolute path,
 *   - an ABSOLUTE path pointing OUTSIDE the workspace is now REJECTED (the case
 *     the old tautology let through the tool-layer guard),
 *   - a sibling root that merely shares a string prefix is rejected (segment
 *     boundary),
 *   - a case-drifted absolute path fails CLOSED on Windows (isolation-safe),
 *   - `..` traversal is still refused (matter guard),
 *   - search_files' matter filter still works with a native backslash root.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';

type ToolExecutor = (name: string, params: Record<string, unknown>) => Promise<unknown>;

// `captured` + `mocks` live in vi.hoisted so the provider-mock factories (which
// are hoisted to the top of the module) can close over them. The stub provider
// records the tool executor the send path registers via setTools.
const { captured, mocks, authoritativeSelection } = vi.hoisted(() => ({
  captured: { executor: null as ToolExecutor | null },
  mocks: { sendMessage: vi.fn() },
  authoritativeSelection: {
    hookRequests: [] as Array<Record<string, unknown>>,
    readRequests: [] as Array<Record<string, unknown>>,
    decision: { kind: 'all-matters', client: null } as
      | { kind: 'all-matters'; client: null }
      | { kind: 'matter'; sourceKind: 'matter-only'; matter: Matter; client: null }
      | { kind: 'refused'; reason: 'blocked-unresolved' | 'follower-disagreement'; message: string },
  },
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: (request: Record<string, unknown>) => {
    authoritativeSelection.hookRequests.push(request);
    return authoritativeSelection.decision;
  },
  readSelectionOperationDecision: (request: Record<string, unknown>) => {
    authoritativeSelection.readRequests.push(request);
    return authoritativeSelection.decision;
  },
}));

function makeStubProvider() {
  return class StubProvider {
    setTools(_tools: unknown, executor: ToolExecutor) {
      captured.executor = executor;
    }
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() {
      return { model: 'stub', providerId: 'anthropic' };
    }
  };
}
vi.mock('@/platform/providers/ClaudeProvider', () => ({ ClaudeProvider: makeStubProvider() }));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: makeStubProvider(),
  OPENAI_DEFAULT_MODEL: 'gpt-4o',
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: makeStubProvider() }));

vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

// Focus on the path guard, not the confidentiality-choice / local-only gates.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
    assertLocalOnlyAllowsSend: vi.fn(),
    isLocalOnlyMode: () => false,
  };
});

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile } from '@/platform/types/ai';
import type { Matter } from '@/platform/types/matter';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useMatterStore } from '@/platform/matter/matterStore';

const CHAT_ID = 'path-guard-test';
const chat: AIChatFile = {
  id: CHAT_ID,
  title: 'Path Guard',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  messages: [],
  provider: 'anthropic',
  model: 'stub',
};
const apiKey = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];

/** A WorkspaceService-shaped mock whose methods the tool executor calls. */
function makeWorkspaceMock() {
  const fileTree: unknown[] = [];
  const ws = {
    readFile: vi.fn(async () => 'file contents'),
    readFileBinary: vi.fn(async () => new ArrayBuffer(0)),
    writeFile: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    stat: vi.fn(async (p: string) => ({ path: p, name: p, type: 'file', size: 0 })),
    list: vi.fn(async () => [] as unknown[]),
    mkdir: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    getFileTree: vi.fn(async () => fileTree),
    getBackend: () => null,
  };
  return { ws, fileTree };
}

function grantConsent() {
  useAIChatStore.setState({
    sessions: {},
    dailyCosts: {},
    askWorkspaceMode: {},
    fileAccessConsent: {
      [CHAT_ID]: { state: 'granted', grantedScope: { kind: 'allMatters' } },
    },
  });
}

/**
 * Render the chat with a native `rootPath`, send one plain message so the send
 * path registers the file tools, and return the captured executor + the WS mock.
 */
async function setup(rootPath: string) {
  const { ws, fileTree } = makeWorkspaceMock();
  const ref = { current: ws } as unknown as MutableRefObject<never>;
  captured.executor = null;
  render(
    <AIChatViewer
      chatData={chat}
      apiKeys={apiKey}
      workspaceServiceRef={ref}
      rootPath={rootPath}
    />,
  );
  const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
  act(() => fireEvent.change(textarea, { target: { value: 'hello' } }));
  act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
  await waitFor(() => expect(captured.executor).toBeTypeOf('function'));
  return { executor: captured.executor as unknown as ToolExecutor, ws, fileTree };
}

// [ root, expected-normalized-join-of "notes.txt" ]
const ROOTS: Array<[label: string, root: string, expectedJoin: string]> = [
  ['POSIX', '/ws/Acme', '/ws/Acme/notes.txt'],
  ['Windows drive (backslashes)', 'C:\\WS\\Acme', 'C:/WS/Acme/notes.txt'],
  ['UNC', '\\\\server\\share\\ws', '//server/share/ws/notes.txt'],
];

describe('F2.8 useChatSending workspace-boundary guard — per tool, per platform', () => {
  beforeEach(() => {
    authoritativeSelection.hookRequests = [];
    authoritativeSelection.readRequests = [];
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue({
      content: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'stub',
    });
    useMatterStore.setState({ matters: [], activeMatterId: null }); // all-matters
    authoritativeSelection.decision = { kind: 'all-matters', client: null };
    grantConsent();
  });
  afterEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
    captured.executor = null;
  });

  for (const [label, root, expectedJoin] of ROOTS) {
    describe(label, () => {
      it('read_file: allows an in-workspace path, reaching the FS with a normalized absolute path', async () => {
        const { executor, ws } = await setup(root);
        const res = (await executor('read_file', { path: 'notes.txt' })) as { content: string };
        expect(res.content).toBe('file contents');
        expect(ws.readFile).toHaveBeenCalledWith(expectedJoin);
      });

      it('list_files: allows an in-workspace dir, reaching the FS with a normalized absolute path', async () => {
        const { executor, ws } = await setup(root);
        await executor('list_files', { path: 'sub' });
        expect(ws.list).toHaveBeenCalledWith(expectedJoin.replace('/notes.txt', '/sub'));
      });

      it('read_file: REJECTS an absolute path OUTSIDE the workspace (old tautology let this through)', async () => {
        const { executor, ws } = await setup(root);
        // An absolute path on a different volume / outside the root.
        const escape = label === 'POSIX' ? '/etc/passwd' : 'D:/secret/other.txt';
        await expect(executor('read_file', { path: escape })).rejects.toThrow(/outside workspace/);
        expect(ws.readFile).not.toHaveBeenCalledWith(expect.stringContaining('passwd'));
      });

      it('write_file / create_folder / delete_file: REJECT an absolute escape before any FS write', async () => {
        const { executor, ws } = await setup(root);
        const escape = label === 'POSIX' ? '/etc/evil' : 'D:/evil';
        await expect(executor('write_file', { path: escape, content: 'x' })).rejects.toThrow(/outside workspace/);
        await expect(executor('create_folder', { path: escape })).rejects.toThrow(/outside workspace/);
        await expect(executor('delete_file', { path: escape })).rejects.toThrow(/outside workspace/);
        expect(ws.writeFile).not.toHaveBeenCalled();
        expect(ws.mkdir).not.toHaveBeenCalled();
        expect(ws.move).not.toHaveBeenCalled();
      });

      it('move_file: REJECTS when EITHER endpoint is outside the workspace', async () => {
        const { executor } = await setup(root);
        const escape = label === 'POSIX' ? '/etc/evil' : 'D:/evil';
        await expect(executor('move_file', { from: 'notes.txt', to: escape })).rejects.toThrow(/outside workspace/);
        await expect(executor('move_file', { from: escape, to: 'notes.txt' })).rejects.toThrow(/outside workspace/);
      });

      it('read_file: still REFUSES ".." traversal', async () => {
        const { executor } = await setup(root);
        // sameOrInside now resolves dot-segments before comparing (Wave 4
        // Track D retention fix — a workspace-relative path with '..' used
        // to string-prefix-match as "inside" even though it denoted a path
        // outside root). That means the WORKSPACE-level guard
        // (sameOrInside(rootPath, workspacePath(rootPath, rel)) in
        // useChatSending.ts) now correctly rejects this escape itself,
        // before the matter-specific guard (assertInActiveMatter's own
        // explicit '..'-segment check, "must not contain '..'") ever gets a
        // chance to fire. Either message is a correct rejection; this
        // assertion checks the boundary is still refused, not which of the
        // two layered guards catches it first.
        await expect(executor('read_file', { path: '../secret.txt' })).rejects.toThrow(/outside workspace|must not contain/);
      });
    });
  }

  it('REJECTS a sibling root that merely shares a string prefix (segment boundary)', async () => {
    // The old raw startsWith would treat an absolute "/ws/AcmeEvil/x" as inside
    // "/ws/Acme"; sameOrInside respects segment boundaries and refuses it.
    const { executor } = await setup('/ws/Acme');
    await expect(executor('read_file', { path: '/ws/AcmeEvil/x.txt' })).rejects.toThrow(/outside workspace/);
  });

  it('Windows: a CASE-DRIFTED absolute path fails CLOSED (isolation-safe)', async () => {
    // Drive letter is case-insensitive, but directory segments are the client
    // boundary and are compared case-sensitively — so "acme" != "Acme" is
    // refused rather than silently folded into the wrong client's scope.
    const { executor, ws } = await setup('C:\\WS\\Acme');
    await expect(executor('read_file', { path: 'c:/ws/acme/doc.txt' })).rejects.toThrow(/outside workspace/);
    expect(ws.readFile).not.toHaveBeenCalledWith(expect.stringContaining('acme'));
  });

  it('surfaces blocked source selection and disables the real send controls', () => {
    authoritativeSelection.decision = {
      kind: 'refused',
      reason: 'blocked-unresolved',
      message: 'Choose a valid client before sending.',
    };
    const { ws } = makeWorkspaceMock();
    const ref = { current: ws } as unknown as MutableRefObject<never>;

    render(
      <AIChatViewer
        chatData={chat}
        apiKeys={apiKey}
        workspaceServiceRef={ref}
        rootPath="/ws"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid client before sending.');
    expect(screen.getByTestId('chat-input')).toBeDisabled();
    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('refuses and surfaces a follower disagreement that appears at the real send boundary', async () => {
    authoritativeSelection.decision = { kind: 'all-matters', client: null };
    const { ws } = makeWorkspaceMock();
    const ref = { current: ws } as unknown as MutableRefObject<never>;
    render(
      <AIChatViewer
        chatData={chat}
        apiKeys={apiKey}
        workspaceServiceRef={ref}
        rootPath="/ws"
      />,
    );
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } });
    authoritativeSelection.decision = {
      kind: 'refused',
      reason: 'follower-disagreement',
      message: 'The client selection is still catching up.',
    };

    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    expect(
      (await screen.findAllByText('The client selection is still catching up.')).length,
    ).toBeGreaterThan(0);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(authoritativeSelection.hookRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requireFollowerAgreement: true }),
      ]),
    );
    expect(authoritativeSelection.readRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationClass: 'matter-scoped',
          requireFollowerAgreement: true,
        }),
      ]),
    );
  });
});

describe('F2.8 search_files matter filter — normalized join on a backslash root', () => {
  const ROOT = 'C:\\WS';
  let matterId: string;

  beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue({
      content: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'stub',
    });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    const m = useMatterStore.getState().createMatter({
      name: 'Acme',
      client: 'Acme Corp',
      folderPaths: ['C:/WS/Clients/Acme'], // forward-slash normalized, as stored
    });
    useMatterStore.getState().setActiveMatter(m.id);
    authoritativeSelection.decision = {
      kind: 'matter',
      sourceKind: 'matter-only',
      matter: m,
      client: null,
    };
    matterId = m.id;
    grantConsent();
  });
  afterEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
    captured.executor = null;
  });

  it('keeps the in-matter file and drops a sibling matter file (join fed to the matter guard)', async () => {
    expect(matterId).toBeTruthy();
    const { ws, fileTree } = makeWorkspaceMock();
    // A tree with one file inside the active matter and one in a sibling folder.
    fileTree.push(
      {
        name: 'Clients',
        type: 'folder',
        children: [
          { name: 'Acme', type: 'folder', children: [{ name: 'plan.txt', type: 'file' }] },
          { name: 'Beta', type: 'folder', children: [{ name: 'secret.txt', type: 'file' }] },
        ],
      },
    );
    const ref = { current: ws } as unknown as MutableRefObject<never>;
    captured.executor = null;
    render(
      <AIChatViewer chatData={chat} apiKeys={apiKey} workspaceServiceRef={ref} rootPath={ROOT} />,
    );
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'hello' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
    await waitFor(() => expect(captured.executor).toBeTypeOf('function'));

    const res = (await (captured.executor as unknown as ToolExecutor)('search_files', { query: '*.txt' })) as {
      results: Array<{ path: string }>;
    };
    const paths = res.results.map((r) => r.path);
    expect(paths).toContain('Clients/Acme/plan.txt');
    expect(paths).not.toContain('Clients/Beta/secret.txt');
  });
});
