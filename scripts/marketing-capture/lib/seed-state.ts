/**
 * State seeder — applies per-shot UI state to a running Projelli dev server
 * via the `window.__projelli_seed` bridge (T03).
 *
 * Shape notes (verified against actual store definitions 2026-04-27):
 *  - workspaceStore: rootPath, fileTree, selectedPath, expandedPaths (Set)  ✓
 *  - editorStore:    openTabs (NOT "tabs"), activeTabPath, showBacklinks     FIXED
 *  - aiChatStore:    sessions is Record<string, ChatSession> (NOT array)     FIXED
 *  - settingsStore:  values: Record<string,unknown> — no top-level
 *                    providers/defaultProvider/defaultModel fields;
 *                    provider state is managed by ApiKeySettings; we skip
 *                    seeding settings for now (it only affects S06).        NOTE
 *
 * WorkspaceSelector bypass:
 *  App.tsx uses a React useState `showWorkspaceSelector` (not Zustand) that
 *  initializes to `!IS_TEST_MODE`. IS_TEST_MODE is true when the URL has
 *  `?testMode=true`. The dev server MUST be navigated to with that query
 *  param — callers are responsible for using the correct URL. The compose-
 *  chrome and orchestrator helpers set this automatically.
 *
 * Set serialization:
 *  Playwright's page.evaluate serializes arguments via structured clone.
 *  Set objects do NOT survive the boundary — they arrive as plain objects.
 *  expandedPaths is passed as a string[] and reconstructed inside the
 *  browser context before calling __projelli_seed.
 *
 * Per-shot overrides:
 *  - aiMidStream: opens an ai-assistant tab with a partial streaming message
 *    (isLoading: true on the session so the typing indicator renders).
 *  - wikiLinks: sets showBacklinks: true in editorStore so the backlinks
 *    panel is visible below the editor.
 */
import type { Page } from 'playwright';
import type { LinterlyFixture } from '../fixtures/linterly-workspace';

export type ShotKey = keyof LinterlyFixture['shots'];

// Partial streaming content used for the AI mid-stream shot (~60% of the
// launch-plan-stream fixture — stops mid-sentence to look "in progress").
const STREAMING_PARTIAL_CONTENT =
  "Here's a brand-voice draft for Linterly:\n\n" +
  '**Voice principles**\n\n' +
  'Linterly writes the way a senior PM Slacks: short, specific, ' +
  'contraction-heavy, never breathless.\n\n' +
  '**Banned words:** leverage, delve, seamless, transform, empow';

export async function seedState(
  page: Page,
  fixture: LinterlyFixture,
  shot: ShotKey,
): Promise<void> {
  // Wait for the bridge to mount (it runs after React hydrates).
  await page.waitForFunction(
    () => typeof (window as any).__projelli_seed === 'function',
    null,
    { timeout: 10_000 },
  );

  const shotConfig = fixture.shots[shot] as Record<string, unknown>;
  const activeFile = shotConfig.activeFile as string | undefined;
  const rootPath = fixture.rootPath;

  // ------------------------------------------------------------------
  // Build serialisable payload. Note: pass expandedPaths as string[]
  // because Set does not survive Playwright's structured-clone boundary.
  // The browser-side evaluate reconstructs the Set before calling seed().
  // ------------------------------------------------------------------

  const workspacePayload = {
    rootPath,
    fileTree: fixture.files,
    selectedPath: activeFile ? `${rootPath}/${activeFile}` : null,
    // Passed as array; reconstructed into Set in the browser context below.
    expandedPathsArray: [rootPath],
    // Non-empty recentWorkspaces prevents the FirstRunWizard trigger
    // (which fires when recentWorkspaces.length === 0).
    recentWorkspaces: [{ path: rootPath, name: 'Linterly', lastOpened: Date.now() }],
  };

  // ── Shot-specific editor payload ─────────────────────────────────────────

  let editorPayload: Record<string, unknown> | null = null;

  if (shot === 'aiMidStream') {
    // S02: Show two tabs — Launch Plan.md + an ai-assistant tab (active).
    // The ai-assistant tab's content is an AIChatFile JSON so the viewer
    // has a known chatId it can look up in aiChatStore.
    const chatId = 'ai-stream-session';
    const chatFileContent = JSON.stringify({
      id: chatId,
      title: 'Drafting brand voice for Linterly',
      created: new Date(2026, 3, 27).toISOString(),
      updated: new Date(2026, 3, 27).toISOString(),
      messages: [],
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    });

    editorPayload = {
      openTabs: [
        {
          path: `${rootPath}/Launch Plan.md`,
          name: 'Launch Plan.md',
          content: fixture.fileContents['Launch Plan.md'] ?? '',
          isDirty: false,
          type: 'file',
        },
        {
          path: chatId,
          name: 'Drafting brand voice for Linterly',
          content: chatFileContent,
          isDirty: false,
          type: 'ai-assistant',
        },
      ],
      activeTabPath: chatId,
      showBacklinks: false,
    };
  } else if (shot === 'wikiLinks') {
    // S03: Vision.md is the active file with backlinks panel open.
    editorPayload = {
      openTabs: [
        {
          path: `${rootPath}/${activeFile}`,
          name: activeFile,
          content: fixture.fileContents[activeFile ?? ''] ?? '',
          isDirty: false,
          type: 'file',
        },
      ],
      activeTabPath: `${rootPath}/${activeFile}`,
      showBacklinks: true,
    };
  } else if (activeFile) {
    // Default: single tab for the active file.
    editorPayload = {
      openTabs: [
        {
          path: `${rootPath}/${activeFile}`,
          name: activeFile,
          content: fixture.fileContents[activeFile] ?? '',
          isDirty: false,
          type: 'file',
        },
      ],
      activeTabPath: `${rootPath}/${activeFile}`,
    };
  }

  // ── aiChat payload ───────────────────────────────────────────────────────

  // Base sessions from the fixture's chats array.
  const sessions: Record<string, unknown> = {};
  for (const chat of fixture.chats) {
    sessions[chat.id] = {
      chatId: chat.id,
      messages: chat.messages,
      isLoading: false,
      lastUpdated: chat.createdAt,
    };
  }

  // S02: inject the streaming session with a partial assistant message and
  // isLoading: true so the chat viewer renders the typing indicator.
  if (shot === 'aiMidStream') {
    const chatId = 'ai-stream-session';
    sessions[chatId] = {
      chatId,
      messages: [
        {
          role: 'user',
          content: 'Write a brand voice guide for Linterly and save it to Brand Voice.md.',
          timestamp: new Date(2026, 3, 27, 14, 22).toISOString(),
        },
        {
          role: 'assistant',
          content: STREAMING_PARTIAL_CONTENT,
          timestamp: new Date(2026, 3, 27, 14, 22, 5).toISOString(),
        },
      ],
      isLoading: true,
      lastUpdated: new Date(2026, 3, 27, 14, 22, 5).toISOString(),
    };
  }

  const aiChatPayload = { sessions };

  await page.evaluate(
    ({ workspacePayload, editorPayload, aiChatPayload }) => {
      const seed = (window as any).__projelli_seed!;

      // Reconstruct Set from serialised array.
      const { expandedPathsArray, ...workspaceRest } = workspacePayload as any;
      const workspace = {
        ...workspaceRest,
        expandedPaths: new Set(expandedPathsArray as string[]),
      };

      seed({
        skipOnboarding: true,
        workspace,
        editor: editorPayload ?? undefined,
        aiChat: aiChatPayload,
      });
    },
    { workspacePayload, editorPayload, aiChatPayload },
  );

  // Give React one render cycle to process the setState calls.
  await page.waitForTimeout(200);
}
