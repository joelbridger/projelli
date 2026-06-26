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

/** Parse a captured OpenAI SSE body into the replay fixture's chunk list. */
function parseOpenAISse(body) {
  const chunks = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(payload); } catch { continue; }
    const text = ev?.choices?.[0]?.delta?.content;
    if (text) chunks.push({ delayMs: CHUNK_DELAY_MS, text });
  }
  if (chunks.length) chunks[0].delayMs = 0;
  return chunks;
}

async function main() {
  await ensureTunnel();
  const page = await getPage();

  log('opening Northcrest workspace…');
  const opened = await openWorkspace(page, {});
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);

  // Pass-through capture on the OpenAI chat-completions path ONLY (so we don't
  // capture peripheral /models calls). Forward to the real provider, snapshot the
  // streamed body, and fulfill the app with it so the answer + citations render.
  const captured = [];
  let model = 'gpt-4o';
  const chatPaths = ['**/api/openai/v1/chat/completions', '**/api.openai.com/v1/chat/completions'];
  for (const pattern of chatPaths) {
    await page.route(pattern, async (route) => {
      try {
        const post = route.request().postData();
        if (post) { try { const j = JSON.parse(post); if (j.model) model = j.model; } catch { /* ignore */ } }
      } catch { /* ignore */ }
      try {
        const response = await route.fetch();
        const body = await response.text();
        captured.push(body);
        await route.fulfill({ response, body });
      } catch (e) {
        log(`pass-through error: ${e.message}`);
        await route.continue().catch(() => {});
      }
    });
  }

  log('asking the question LIVE (capturing the provider stream)…');
  const result = await askQuestion(page, { question: QUESTION, deterministic: false, matterId: MATTER });
  log(`ask ok=${result.ok} settled=${result.settled} newChips=${result.newCitationChips}`);
  if (!captured.length) throw new Error('no OpenAI chat-completions stream was captured — did Ask resolve to OpenAI?');

  // Use the LAST captured stream (the final answer turn).
  const chunks = parseOpenAISse(captured[captured.length - 1]);
  if (!chunks.length) throw new Error('captured stream had no choices[].delta.content — wrong provider/wire format?');

  const fixture = {
    model,
    wireFormat: 'openai',
    recordedAt: new Date().toISOString(),
    question: QUESTION,
    matterId: MATTER,
    note: 'Recorded against the FROZEN snapshot so citation markers stay stable on replay.',
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
