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
// How it works: it installs a pass-THROUGH route on the OpenAI chat-completions
// path that forwards to the real provider, captures the streamed SSE body, and
// fulfills the app with it (so the UI still answers + cites). After the answer
// settles it parses the captured OpenAI frames into the replay fixture format and
// writes scripts/robot/fixtures/ai-replays/<name>.json.
//
// Run:  node scripts/robot/record-ask-fixture.mjs [--name=ask-portfolio] [--matter=matter_nc_hollings_family] [--question="..."]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTunnel } from './bench.mjs';
import { getPage, disconnect } from './connection.mjs';
import { openWorkspace } from './verbs/workspace.mjs';
import { askQuestion } from './verbs/ask.mjs';

const args = process.argv.slice(2);
const argVal = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const NAME = argVal('name', 'ask-portfolio');
const MATTER = argVal('matter', 'matter_nc_hollings_family');
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

  // Capture model from the live request (best-effort).
  let model = null;
  const isChat = (u) => /\/chat\/completions(?:[/?#]|$)/.test(String(u || ''));
  page.on('request', (req) => {
    try { if (isChat(req.url())) { const j = JSON.parse(req.postData() || '{}'); if (j.model) model = j.model; } } catch { /* ignore */ }
  });

  log('asking the question LIVE (against the frozen snapshot)…');
  const result = await askQuestion(page, { question: QUESTION, deterministic: false, matterId: MATTER });
  await new Promise((r) => setTimeout(r, 1000));
  log(`ask ok=${result.ok} settled=${result.settled} newChips=${result.newCitationChips}`);
  if (!result.settled) throw new Error('Ask did not settle — cannot record a fixture');

  // Read the FULL assistant answer (with its {N} citation markers) from the app's
  // chat store. We can't read the raw SSE body (Playwright doesn't buffer
  // text/event-stream), and the on-disk answer is the faithful, marker-preserving
  // source. Replaying THIS text against the frozen index reproduces the citations.
  const captured = await page.evaluate(() => {
    let answer = null; let foundModel = null;
    try {
      const j = JSON.parse(localStorage.getItem('ai-chat-storage') || 'null');
      const s = (j && (j.state || j)) || {};
      const walk = (o, depth = 0) => {
        if (!o || depth > 6) return;
        if (Array.isArray(o)) {
          for (const m of o) {
            if (m && /assist|^ai$|model/i.test(String(m.role || '')) && typeof m.content === 'string' && m.content.trim()) {
              answer = m.content; if (m.model) foundModel = m.model; // keep walking → last wins
            }
          }
          for (const m of o) walk(m, depth + 1);
        } else if (typeof o === 'object') {
          for (const k of Object.keys(o)) walk(o[k], depth + 1);
        }
      };
      walk(s);
    } catch (e) { return { error: String(e) }; }
    return { answer, foundModel };
  });
  if (!captured || captured.error || !captured.answer) {
    throw new Error(`could not read the assistant answer from ai-chat-storage: ${JSON.stringify(captured)}`);
  }
  model = model || captured.foundModel || 'gpt-4o-mini';
  const answer = captured.answer;
  log(`captured answer (${answer.length} chars): ${JSON.stringify(answer.slice(0, 200))}`);

  // Split into word-sized streaming chunks (boundaries are cosmetic; the app
  // accumulates them back into the same full text).
  const parts = answer.match(/\S+\s*/g) || [answer];
  const chunks = parts.map((text, i) => ({ delayMs: i === 0 ? 0 : CHUNK_DELAY_MS, text }));

  const fixture = {
    model,
    wireFormat: 'openai',
    recordedAt: new Date().toISOString(),
    question: QUESTION,
    matterId: MATTER,
    note: 'Answer text recorded from the app chat store against the FROZEN snapshot, so the {N} citation markers map to the same retrieved sources on replay.',
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
