// scripts/robot/record-ask-fixture.mjs — record a PROVIDER-ACCURATE OpenAI Ask
// fixture from one LIVE run, so the Windows smoke can replay it deterministically.
//
// IMPORTANT — record against the FROZEN snapshot. The Ask answer's citation
// markers reference whatever chunks RAG retrieval returned; retrieval is only
// stable if the index is frozen. So the order is:
//   1. node scripts/robot/build-snapshot.mjs        (build the golden archive)
//   2. node scripts/robot/cli.mjs reset '{"mode":"snapshot"}'  (restore it)
//   3. node scripts/robot/record-ask-fixture.mjs     (record against that world)
// Recording against a live/un-frozen index will produce a fixture whose citations
// drift, defeating determinism.
//
// How it works: it listens for the real OpenAI chat-completions response (no
// interception — this is a genuine live call) and reads its FULL SSE body via
// Playwright's own response buffering, which handles text/event-stream fine.
// It parses the OpenAI delta frames to reconstruct the RAW streamed answer —
// crucially INCLUDING the `[[BLOCK:FILES]]`-style protocol marker the model
// emits, which the app strips before ever persisting anything to its chat
// store (bindAnswerBlocks in useAsk.ts rewrites the raw stream into display
// text before it's saved). A fixture built from the app's post-processed,
// marker-stripped storage can never replay as cited — every replay would
// reclassify as "general guidance" regardless of retrieval/indexing state,
// which is exactly the bug this file used to have. After the answer settles
// it parses the captured OpenAI frames into the replay fixture format and
// writes scripts/robot/fixtures/ai-replays/<name>.json.
//
// Run:  node scripts/robot/record-ask-fixture.mjs [--name=ask-portfolio] [--matter=<matter id>] [--question="..."]
// --matter defaults to whatever id "Hollings Family" currently resolves to
// (matter ids are fresh random UUIDs per CRM reseed, not a fixed slug).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTunnel } from './bench.mjs';
import { getPage, disconnect } from './connection.mjs';
import { openWorkspace } from './verbs/workspace.mjs';
import { askQuestion } from './verbs/ask.mjs';
import { resolveMatterId } from './verbs/matters.mjs';

const args = process.argv.slice(2);
const argVal = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const NAME = argVal('name', 'ask-portfolio');
const MATTER = argVal('matter', null); // null => askQuestion resolves "Hollings Family" itself
const QUESTION = argVal('question', 'What is the total portfolio value for this household?');
const CHUNK_DELAY_MS = Number(process.env.RECORD_CHUNK_DELAY_MS || 6);

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ai-replays', `${NAME}.json`);
const log = (m) => console.log(`[record-ask] ${m}`);

async function main() {
  await ensureTunnel();
  const page = await getPage();

  log('opening Northcrest workspace…');
  const opened = await openWorkspace(page, {});
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);

  const matterId = MATTER || (await resolveMatterId(page, 'Hollings Family'));
  if (!matterId) throw new Error('could not resolve a matter id for "Hollings Family"');

  // Capture model from the live request, and the RAW answer text from the live
  // response — both best-effort, from the real (uninteded) network traffic.
  let model = null;
  let rawAnswer = '';
  const isChat = (u) => /\/chat\/completions(?:[/?#]|$)/.test(String(u || ''));
  page.on('request', (req) => {
    try { if (isChat(req.url())) { const j = JSON.parse(req.postData() || '{}'); if (j.model) model = j.model; } } catch { /* ignore */ }
  });
  page.on('response', (res) => {
    if (!isChat(res.url())) return;
    res
      .text()
      .then((body) => {
        for (const line of body.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const frame = JSON.parse(payload);
            const delta = frame?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') rawAnswer += delta;
          } catch { /* ignore a partial/non-JSON line */ }
        }
      })
      .catch(() => { /* response body unavailable (aborted, etc.) — best-effort */ });
  });

  log('asking the question LIVE (against the frozen snapshot)…');
  const result = await askQuestion(page, { question: QUESTION, deterministic: false, matterId });
  await new Promise((r) => setTimeout(r, 1000));
  log(`ask ok=${result.ok} settled=${result.settled} newChips=${result.newCitationChips}`);
  if (!result.settled) throw new Error('Ask did not settle — cannot record a fixture');
  if (!rawAnswer.trim()) {
    throw new Error('could not capture the raw chat-completions response body (rawAnswer empty)');
  }
  model = model || 'gpt-4o-mini';
  const answer = rawAnswer;
  log(`captured RAW answer (${answer.length} chars, has block marker: ${/\[\[BLOCK:/.test(answer)}): ${JSON.stringify(answer.slice(0, 200))}`);

  // Split into word-sized streaming chunks (boundaries are cosmetic; the app
  // accumulates them back into the same full text).
  const parts = answer.match(/\S+\s*/g) || [answer];
  const chunks = parts.map((text, i) => ({ delayMs: i === 0 ? 0 : CHUNK_DELAY_MS, text }));

  const fixture = {
    model,
    wireFormat: 'openai',
    recordedAt: new Date().toISOString(),
    question: QUESTION,
    matterId,
    note: 'RAW answer text captured from the live chat-completions SSE response (not the app\'s post-processed chat-store content, which strips block markers) against the FROZEN snapshot, so the [[BLOCK:...]] classification marker and {N} citation markers map to the same retrieved sources on replay.',
    answerText: answer,
    chunks,
  };
  writeFileSync(OUT, JSON.stringify(fixture, null, 2));
  log(`wrote ${OUT} (${chunks.length} chunks, model=${model})`);

  return { ok: result.ok && chunks.length > 0, chunks: chunks.length, model, askOk: result.ok };
}

main()
  .then(async (r) => {
    await disconnect().catch(() => {});
    console.log('\n=== RECORD-ASK RESULT ===');
    console.log(JSON.stringify(r, null, 2));
    console.log(r.ok ? '\nRECORD: OK' : '\nRECORD: review the captured fixture');
    process.exit(r.ok ? 0 : 1);
  })
  .catch(async (e) => {
    await disconnect().catch(() => {});
    console.error('\nRECORD FAILED:', e.message);
    process.exit(1);
  });
