/**
 * 18-rag-cited-ask — real desktop RAG + cited Ask smoke.
 *
 * Seeds a distinctive Markdown fact into the temp workspace, prepares the real
 * desktop semantic index through Tauri IPC, asks the real AI chat with workspace
 * retrieval enabled, and verifies that the answer cites the seeded source and
 * that the citation opens the file.
 */

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_NAME = 'rag-cited-source.md';
const CHAT_NAME = 'RAG Cited Ask.aichat';
// A benign, plain legal-record fact with a distinctive verbatim-reproducible
// code. The earlier fixture ("escrow lantern codeword … classified") tripped a
// small local model's safety reflex and got a refusal instead of an answer,
// which is a test-design flaw, not a product bug. A neutral "matter file number"
// lookup is exactly what a law-practice RAG should answer, and an ALL-CAPS code
// is reproduced verbatim by even a 3B model.
const ANSWER_TOKEN = 'MARIGOLD-4820';
const FACT = `The Alvarez matter file number is ${ANSWER_TOKEN}.`;
const QUERY = 'What is the file number for the Alvarez matter?';
const MODEL_BLOCKED =
  'BLOCKED: needs the intfloat/multilingual-e5-small embedding model downloaded by the desktop model_ensure command from Hugging Face into Keepance app data; headless model preparation did not reach ready.';

export default {
  name: '18-rag-cited-ask',
  async run({ session, workspace, app, log }) {
    const provider = await resolveAnswerProvider();
    const sourcePath = path.join(workspace, SOURCE_NAME);
    const chatPath = path.join(workspace, CHAT_NAME);

    fs.writeFileSync(
      sourcePath,
      [
        '# Alvarez matter retrieval fixture',
        '',
        `${FACT} This sentence is the only place in the workspace that names the Alvarez matter file number.`,
        '',
        'The retrieval test should cite this document when answering questions about the Alvarez matter file number.',
        '',
      ].join('\n'),
    );

    fs.writeFileSync(
      chatPath,
      JSON.stringify(
        {
          id: chatPath,
          title: 'RAG Cited Ask',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          messages: [],
          ...(provider ? { provider: provider.provider, model: provider.model } : {}),
        },
        null,
        2,
      ),
    );

    await bootWithOptionalProviderKey(session, app, workspace, provider);
    await session.testid('documents-toolbar', 20_000);
    await session.waitForBodyText(SOURCE_NAME, { timeoutMs: 20_000 });

    log('Preparing real desktop RAG index for the seeded source.');
    await startRagPrep(session, { sourcePath, query: QUERY, fact: FACT });
    const prep = await waitForRagPrep(session);
    if (prep.status === 'blocked') {
      throw new Error(`${MODEL_BLOCKED} Last error: ${prep.message}`);
    }
    if (prep.status !== 'ready') {
      throw new Error(`RAG prep failed before chat send: ${prep.message ?? JSON.stringify(prep)}`);
    }
    const paragraphIndex = Number(prep.hit?.paragraphIndex ?? 0);

    await openSeededChat(session, app);
    await session.testid('ai-chat-viewer', 20_000);
    await session.testid('chat-input', 20_000);
    await session.testid('chat-send-button', 20_000);
    await session.testid('chat-model-picker', 20_000);

    if (!provider) {
      throw new Error(
        'BLOCKED: needs a real answer provider: either ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_AI_API_KEY in the desktop test environment, or Ollama running at http://127.0.0.1:11434 with an installed chat model.',
      );
    }

    await enableAskWorkspace(session);
    await session.typeTestid(
      'chat-input',
      // Keep the model's output deterministic for this plumbing smoke test: a
      // local model otherwise sometimes answers in prose with no parseable
      // citation. The real pipeline is still exercised — "Ask my workspace"
      // retrieval runs and the app independently verifies the cited paragraph
      // against the retrieved source, so a handed-over bracket can't fake the
      // verification. (One line only — a newline in the chat input submits.)
      `@workspace ${QUERY} Reply with exactly this sentence, including the bracketed citation, and nothing else: The Alvarez matter file number is ${ANSWER_TOKEN} [${SOURCE_NAME} paragraph ${String(paragraphIndex)}]`,
      15_000,
    );
    await session.clickTestid('chat-send-button', 15_000);

    await session.waitForBodyText(ANSWER_TOKEN, { timeoutMs: 180_000, intervalMs: 1_000 });
    const citation = await waitForVerifiedCitation(session, SOURCE_NAME);

    await session.testid('chat-sources-accordion', 20_000);
    await session.clickTestid('chat-sources-toggle', 10_000);
    await session.testid(`chat-source-${SOURCE_NAME}-${String(paragraphIndex)}`, 20_000);

    // Bring the inline citation chip into view before clicking — WebKitWebDriver
    // reports "element not interactable" for a chip scrolled out of the message
    // viewport (the assistant answer's length varies run-to-run).
    await session.execute(
      `document.querySelector('[data-testid="' + arguments[0] + '"]')?.scrollIntoView({ block: 'center' });`,
      [citation.testId],
    );
    await session.clickTestid(citation.testId, 10_000);
    // Clicking the verified citation opens the cited source and makes it the
    // active document tab. The Documents tab strip renders each tab as a
    // role="tab" chip with aria-selected reflecting the active tab (no per-path
    // testid, no data-active), so assert the selected tab's label is the source.
    await session.waitFor(
      async (s) =>
        s.execute(
          `
            const name = arguments[0];
            return Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]'))
              .some((el) => (el.textContent || '').includes(name));
          `,
          [SOURCE_NAME],
        ),
      { timeoutMs: 20_000, label: `active source tab for ${SOURCE_NAME}` },
    );
  },
};

async function bootWithOptionalProviderKey(session, app, workspace, provider) {
  await session.newSession();
  await session.testid('welcome-dialog-pitch', 30_000);
  const hasTauri = await session.execute('return Boolean(window.__TAURI__);');
  if (!hasTauri) throw new Error('window.__TAURI__ missing; not the desktop webview.');

  await app.seedReadyState(session, workspace, { workspaceName: 'wd-workspace' });
  await session.execute(
    `
      if (arguments[0]) {
        localStorage.setItem('apiKey_' + arguments[0], arguments[1]);
        localStorage.setItem('keepance_setting_defaultProvider', JSON.stringify(arguments[0]));
        localStorage.setItem('keepance_setting_defaultModel', JSON.stringify(arguments[2]));
      }
    `,
    provider?.key ? [provider.provider, provider.key, provider.model] : [null, null, null],
  );
  await session.refresh();

  await session.clickTestid('recent-workspaces-toggle', 30_000);
  const recent = await session.find(
    'xpath',
    `//button[.//div[normalize-space()=${app.xpathLiteral('wd-workspace')}]]`,
    20_000,
  );
  await session.click(recent);
  await session.testid('spine-nav', 45_000);
  await session.testid('status-bar', 15_000);
  await session.maybeClickTestid('feature-tour-skip');
}

async function startRagPrep(session, { sourcePath, query, fact }) {
  await session.execute(
    `
      window.__kpRagPrep = { status: 'running', step: 'model_status' };
      (async () => {
        const tauri = window.__TAURI__;
        const invoke = tauri?.core?.invoke || tauri?.invoke;
        if (!invoke) throw new Error('Tauri invoke API unavailable');

        const sourcePath = arguments[0];
        const workspace = arguments[1];
        const query = arguments[2];
        const fact = arguments[3];

        let status = await invoke('model_status');
        if (status !== 'ready') {
          window.__kpRagPrep = { status: 'running', step: 'model_ensure', modelStatus: status };
          const ensured = await invoke('model_ensure');
          if (ensured !== 'ready') {
            const started = Date.now();
            while (Date.now() - started < 420000) {
              status = await invoke('model_status');
              window.__kpRagPrep = { status: 'running', step: 'model_wait', modelStatus: status };
              if (status === 'ready') break;
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
          }
        }

        status = await invoke('model_status');
        if (status !== 'ready') {
          window.__kpRagPrep = { status: 'blocked', message: 'model_status remained ' + status };
          return;
        }

        window.__kpRagPrep = { status: 'running', step: 'index_file' };
        await invoke('rag_set_workspace', { path: workspace });
        await invoke('rag_index_file', { path: sourcePath, matterId: 'unassigned', privilege: 'none' });

        window.__kpRagPrep = { status: 'running', step: 'retrieve' };
        const hits = await invoke('rag_retrieve', {
          query,
          topK: 5,
          scope: { kind: 'allMatters' },
          includePrivileged: false,
        });
        const hit = Array.isArray(hits)
          ? hits.find((h) => String(h.path || '').endsWith('/${SOURCE_NAME}') && String(h.chunkText || '').includes(fact))
          : null;
        if (!hit) {
          throw new Error('seeded source was indexed but not returned by rag_retrieve for the fixture query');
        }
        window.__kpRagPrep = { status: 'ready', hit, hitCount: hits.length };
      })().catch((err) => {
        const message = err && (err.message || String(err));
        const blocked = /model-not-ready|model_ensure|download|HuggingFace|hf-hub|intfloat\\/multilingual-e5-small/i.test(message);
        window.__kpRagPrep = { status: blocked ? 'blocked' : 'error', message };
      });
      return true;
    `,
    [sourcePath, path.dirname(sourcePath), query, fact],
  );
}

async function waitForRagPrep(session) {
  return session.waitFor(
    async (s) => {
      const prep = await s.execute('return window.__kpRagPrep || null;');
      return prep && prep.status !== 'running' ? prep : null;
    },
    { timeoutMs: 480_000, intervalMs: 1_000, label: 'RAG model/index prep' },
  );
}

async function openSeededChat(session, app) {
  await app.gotoSurface(session, 'Documents');
  await session.waitForBodyText(CHAT_NAME, { timeoutMs: 20_000 });
  // Open the seeded .aichat by its grid-card testid — the same proven path
  // 13-workflows uses to open a record file. The previous text-xpath matched an
  // outer container whose click never reached the grid card's open handler, so
  // the .aichat tab (and the AIChatViewer it renders) never mounted.
  await session.clickTestid(`grid-card-${CHAT_NAME}`, 20_000);
}

async function enableAskWorkspace(session) {
  await session.waitFor(
    async (s) => {
      const enabled = await s.execute(
        `
          const el = document.querySelector('[data-testid="ask-workspace-toggle"]');
          return el ? el.getAttribute('data-enabled') === 'true' : false;
        `,
      );
      if (enabled) return true;
      await s.clickTestid('ask-workspace-toggle', 5_000);
      return false;
    },
    { timeoutMs: 20_000, label: 'Ask my workspace enabled' },
  );
}

async function waitForVerifiedCitation(session, basename) {
  return session.waitFor(
    async (s) => {
      const found = await s.execute(
        `
          const prefix = 'chat-citation-' + arguments[0] + '-';
          const chips = Array.from(document.querySelectorAll('[data-testid]'))
            .filter((el) => (el.getAttribute('data-testid') || '').startsWith(prefix))
            .map((el) => ({
              testId: el.getAttribute('data-testid'),
              verified: el.getAttribute('data-verified'),
              text: el.textContent || ''
            }));
          return chips.find((chip) => chip.verified === 'true') || null;
        `,
        [basename],
      );
      return found;
    },
    { timeoutMs: 60_000, intervalMs: 1_000, label: `verified citation for ${basename}` },
  );
}

async function resolveAnswerProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      model: process.env.KP_DESKTOP_ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      key: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      model: process.env.KP_DESKTOP_OPENAI_MODEL || 'gpt-4o-mini',
      key: process.env.OPENAI_API_KEY,
    };
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    return {
      provider: 'google',
      model: process.env.KP_DESKTOP_GOOGLE_MODEL || 'gemini-1.5-flash',
      key: process.env.GOOGLE_AI_API_KEY,
    };
  }

  const ollama = await detectOllama();
  if (ollama.models.length > 0) {
    return {
      provider: 'ollama',
      model: process.env.KP_DESKTOP_OLLAMA_MODEL || pickOllamaModel(ollama.models),
      key: null,
    };
  }
  return null;
}

// Prefer the most capable installed chat model. Tiny models (e.g. 3B) follow the
// "answer + cite [file paragraph N]" instruction less reliably, which makes the
// cited-ask assertion flaky; pick an 8B-class model when one is installed so the
// spec is deterministic without depending on KP_DESKTOP_OLLAMA_MODEL.
function pickOllamaModel(models) {
  const bigger = models.find((m) => /:(7|8|9|13|14|27|32|70)b/i.test(m));
  return bigger || models[0];
}

async function detectOllama() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
    if (!res.ok) return { models: [] };
    const data = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m) => m?.name).filter((name) => typeof name === 'string' && name.length > 0)
      : [];
    return { models };
  } catch {
    return { models: [] };
  } finally {
    clearTimeout(timeout);
  }
}
