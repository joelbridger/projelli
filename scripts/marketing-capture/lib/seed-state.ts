/**
 * State seeder — applies per-shot UI state to a running Projelli dev server
 * via the `window.__projelli_seed` bridge (T03).
 *
 * Shape notes (verified against actual store definitions 2026-04-27):
 *  - workspaceStore: rootPath, fileTree, selectedPath, expandedPaths (Set)  ✓
 *  - editorStore:    openTabs (NOT "tabs"), activeTabPath                    FIXED
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
 */
import type { Page } from 'playwright';
import type { LinterlyFixture } from '../fixtures/linterly-workspace';

export type ShotKey = keyof LinterlyFixture['shots'];

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

  // editor — editorStore uses "openTabs", not "tabs"
  const editorPayload = activeFile
    ? {
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
      }
    : null;

  // aiChat — sessions is Record<string, ChatSession>, not an array.
  // Convert the fixture's chats array into the keyed-by-id record shape.
  const sessions: Record<string, unknown> = {};
  for (const chat of fixture.chats) {
    sessions[chat.id] = {
      chatId: chat.id,
      messages: chat.messages,
      isLoading: false,
      lastUpdated: chat.createdAt,
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
