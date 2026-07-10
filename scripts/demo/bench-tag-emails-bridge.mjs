#!/usr/bin/env node
// Tag imported full-practice demo email through the Legion dev bridge.
//
// This runs on the server. Every app call goes over SSH to the Windows bench's
// debug-only bridge at 127.0.0.1:9250. The matching work happens locally, then
// only a compact [{ messageId, matterId }] plan is shipped to the page.
import { spawnSync } from 'node:child_process';
import {
  buildExpectedByMatter,
  buildHouseholdsBySlug,
  buildTagPlanFromMessages,
  buildTaggingContext,
  compactTagPlan,
  loadOutbox,
  loadRoster,
  parseStoredMatters,
  printMatchLoudLists,
  printPreparationLoudLists,
  sampleExpectedMatterRows,
} from './email-tag-core.mjs';

const LEGION = process.env.LEGION_SSH || 'james@100.127.67.22';
const BRIDGE_BASE = 'http://127.0.0.1:9250';
const SSH_CONNECT_TIMEOUT_SEC = 8;
const BRIDGE_TIMEOUT_SEC = 20;
const MAIL_PAGE_SIZE = Number(process.env.BRIDGE_MAIL_PAGE_SIZE || 8);
const MAX_ENCODED_EVAL_CHARS = Number(
  process.env.BRIDGE_EVAL_MAX_CHARS || 3000
);
const POLL_MS = 500;
const TAG_POLL_MS = 1000;
const TAG_TIMEOUT_MS = Number(process.env.BRIDGE_TAG_TIMEOUT_MS || 20 * 60_000);
const VERIFY_SAMPLE_SIZE = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bridgeGet(url, { timeoutSec = BRIDGE_TIMEOUT_SEC } = {}) {
  const ps = `(Invoke-WebRequest -UseBasicParsing -TimeoutSec ${timeoutSec} "${url}").Content`;
  const result = spawnSync(
    'ssh',
    ['-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`, LEGION, ps],
    {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
      timeout: (timeoutSec + SSH_CONNECT_TIMEOUT_SEC + 5) * 1000,
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(`bridge ssh failed (${result.status}): ${stderr}`);
  }

  const text = result.stdout.toString('utf8').trim();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `bridge returned non-JSON: ${String(error).slice(0, 120)} | ${text.slice(0, 300)}`
    );
  }
  if (envelope?.ok === false) {
    throw new Error(`bridge error: ${envelope.error || 'unknown error'}`);
  }
  return Object.prototype.hasOwnProperty.call(envelope, 'result')
    ? envelope.result
    : envelope;
}

function bridgeEval(js, options = {}) {
  const encoded = encodeURIComponent(js);
  if (
    !options.allowOversize &&
    Buffer.byteLength(encoded, 'utf8') > MAX_ENCODED_EVAL_CHARS
  ) {
    throw new Error(
      `eval payload is too large (${Buffer.byteLength(encoded, 'utf8')} encoded chars)`
    );
  }
  return bridgeGet(`${BRIDGE_BASE}/eval?js=${encoded}`, options);
}

function bridgeHealth() {
  return bridgeGet(`${BRIDGE_BASE}/health`, { timeoutSec: 8 });
}

function bridgeVarName(prefix) {
  return `__${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function pollWindowResult(varName, { timeoutMs = 60_000 } = {}) {
  const started = Date.now();
  for (;;) {
    const state = bridgeEval(`window.${varName}||null`, { timeoutSec: 8 });
    if (state?.done) {
      bridgeEval(`delete window.${varName};true`, { timeoutSec: 8 });
      if (!state.ok) throw new Error(state.error || `${varName} failed`);
      return state.result;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${varName} timed out`);
    }
    await sleep(POLL_MS);
  }
}

async function readMailPage(offset, limit) {
  const varName = bridgeVarName('MAILPAGE');
  const js = `(()=>{const v='${varName}',I=window.__TAURI__?.core?.invoke||window.__TAURI__?.invoke;window[v]={done:false};if(!I){window[v]={done:true,ok:false,error:'Tauri invoke bridge is not available'};return true;}I('mail_list_messages',{query:{sortBy:'date',sortDesc:true,limit:${limit},offset:${offset}}}).then(x=>{const a=Array.isArray(x?.items)?x.items:[];window[v]={done:true,ok:true,result:{total:Number(x?.total??a.length),items:a.map(m=>({id:String(m?.id||''),fromAddr:String(m?.fromAddr||''),fromName:String(m?.fromName||''),subject:String(m?.subject||''),receivedDateTime:m?.receivedDateTime||'',snippet:String(m?.snippet||'').slice(0,120)}))}}}).catch(e=>{window[v]={done:true,ok:false,error:String(e?.message||e)}});return true;})()`;
  bridgeEval(js);
  return pollWindowResult(varName, { timeoutMs: 60_000 });
}

async function listAllMessagesViaBridge() {
  const items = [];
  let offset = 0;
  let total = null;

  for (;;) {
    const page = await readMailPage(offset, MAIL_PAGE_SIZE);
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    if (total == null) total = Number(page?.total ?? pageItems.length);
    items.push(...pageItems);
    offset += pageItems.length;

    if (items.length >= total) break;
    if (pageItems.length === 0) {
      console.log(
        `LOUD PAGINATION WARNING: mail_list_messages stopped early at ${items.length}/${total}`
      );
      break;
    }
  }

  return { items, total: total ?? items.length };
}

function stageJs(varName, chunk) {
  return `window.${varName}=(window.${varName}||[]).concat(${JSON.stringify(chunk)});window.${varName}.length`;
}

function chunkForEval(varName, rows) {
  const chunks = [];
  let current = [];
  for (const row of rows) {
    const candidate = [...current, row];
    const js = stageJs(varName, candidate);
    const encodedLen = Buffer.byteLength(encodeURIComponent(js), 'utf8');
    if (encodedLen > MAX_ENCODED_EVAL_CHARS && current.length > 0) {
      chunks.push(current);
      current = [row];
      continue;
    }
    if (encodedLen > MAX_ENCODED_EVAL_CHARS) {
      throw new Error(
        `one ${varName} row is too large for the bridge (${encodedLen} encoded chars)`
      );
    }
    current = candidate;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function stageArray(varName, rows) {
  if (!/^__[A-Z0-9_]+$/.test(varName)) {
    throw new Error(`unsafe window variable name: ${varName}`);
  }
  bridgeEval(`window.${varName}=[];true`, { timeoutSec: 8 });
  const chunks = chunkForEval(varName, rows);
  chunks.forEach((chunk, index) => {
    const count = bridgeEval(stageJs(varName, chunk), { timeoutSec: 8 });
    console.log(
      `staged ${varName} chunk ${index + 1}/${chunks.length}; page now has ${count}`
    );
  });
  return chunks.length;
}

function startTagExecutor() {
  const js =
    "(()=>{const I=window.__TAURI__?.core?.invoke||window.__TAURI__?.invoke,P=Array.isArray(window.__TAGPLAN)?window.__TAGPLAN:[],R=o=>{window.__TAGRESULT={...window.__TAGRESULT,...o,updatedAt:new Date().toISOString()}},F=(e,x)=>{const r=window.__TAGRESULT;r.failureCount++;if(r.failures.length<100)r.failures.push({messageId:e?.messageId,matterId:e?.matterId,error:String(x?.message||x).slice(0,240)})};window.__TAGRESULT={done:false,total:P.length,processed:0,newlyTagged:0,alreadyOk:0,failureCount:0,failures:[],startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};if(!I){R({done:true,error:'Tauri invoke bridge is not available'});return window.__TAGRESULT}(async()=>{for(const e of P){try{let c=null;try{const v=await I('mail_get_message',{id:e.messageId});c=v?.matterId||v?.matter_id||null}catch(_){}await I('mail_retag_message_matter',{messageId:e.messageId,matterId:e.matterId});if(c===e.matterId)window.__TAGRESULT.alreadyOk++;else window.__TAGRESULT.newlyTagged++}catch(x){F(e,x)}window.__TAGRESULT.processed++;if(window.__TAGRESULT.processed%10===0)R({})}R({done:true})})().catch(x=>R({done:true,error:String(x?.message||x).slice(0,500)}));return{started:true,total:P.length}})()";
  return bridgeEval(js);
}

async function pollTagResult(total) {
  const started = Date.now();
  let lastProcessed = -1;
  for (;;) {
    const state = bridgeEval('window.__TAGRESULT||null', { timeoutSec: 8 });
    if (state?.processed !== undefined && state.processed !== lastProcessed) {
      lastProcessed = state.processed;
      console.log(`tag executor progress: ${lastProcessed}/${total}`);
    }
    if (state?.done) return state;
    if (Date.now() - started > TAG_TIMEOUT_MS) {
      throw new Error('tag executor timed out');
    }
    await sleep(TAG_POLL_MS);
  }
}

async function listMatterCountViaBridge(matterId) {
  const varName = bridgeVarName('MATTERCOUNT');
  const matterMapJs =
    "(()=>{try{const p=JSON.parse(localStorage.getItem('keepance:matters')||'{}'),ms=Array.isArray(p?.state?.matters)?p.state.matters:Array.isArray(p?.matters)?p.matters:[],out=[];for(const m of ms){if(m?.id==='unassigned')continue;for(const k of Array.isArray(m?.mailFolderPaths)?m.mailFolderPaths:[]){const s=String(k||''),a=s.indexOf('/');if(a<=0)continue;const provider=s.slice(0,a),rest=s.slice(a+1),b=rest.indexOf('/'),account=b<0?rest:rest.slice(0,b),folderId=b<0?'':rest.slice(b+1);if(provider&&account)out.push({provider,account,folderId,matterId:String(m.id||'')})}}return out}catch(e){return[]}})()";
  const js = `(()=>{const v='${varName}',I=window.__TAURI__?.core?.invoke||window.__TAURI__?.invoke;window[v]={done:false};if(!I){window[v]={done:true,ok:false,error:'Tauri invoke bridge is not available'};return true;}I('mail_list_messages_by_matter',{matterId:${JSON.stringify(matterId)},matterMap:${matterMapJs},query:{sortBy:'date',sortDesc:true,limit:1,offset:0}}).then(x=>{window[v]={done:true,ok:true,result:Number(x?.total??0)}}).catch(e=>{window[v]={done:true,ok:false,error:String(e?.message||e)}});return true;})()`;
  bridgeEval(js);
  return pollWindowResult(varName, { timeoutMs: 60_000 });
}

function printFailures(failures) {
  const rows = Array.isArray(failures) ? failures : [];
  if (rows.length === 0) return;
  console.log('\nLOUD TAG FAILURES:');
  rows.forEach((failure) => {
    console.log(
      `  ${failure.messageId || '(missing message id)'} -> ${failure.matterId || '(missing matter id)'} | ${failure.error || '(no error text)'}`
    );
  });
}

let exitCode = 0;

try {
  console.log(`bridge health: ${JSON.stringify(bridgeHealth())}`);

  const [roster, mattersRaw] = await Promise.all([
    loadRoster(),
    Promise.resolve(
      bridgeEval("localStorage.getItem('keepance:matters')||''", {
        timeoutSec: 8,
      })
    ),
  ]);

  const householdsBySlug = buildHouseholdsBySlug(roster);
  const { records: outboxRecords, missingRoster } =
    await loadOutbox(householdsBySlug);
  const matters = parseStoredMatters(mattersRaw);
  const context = buildTaggingContext(roster, outboxRecords, matters);

  console.log(`loaded roster households: ${roster.length}`);
  console.log(`loaded outbox messages: ${outboxRecords.length}`);
  console.log(`loaded app matters: ${matters.length}`);
  console.log(`loaded app mail-folder mappings: ${context.matterMap.length}`);

  printPreparationLoudLists({ missingRoster, context });

  const { items: messages, total } = await listAllMessagesViaBridge();
  console.log(`mail store messages read: ${messages.length}/${total}`);

  const { matched, unmatchedLikelyDemo, ambiguous } =
    buildTagPlanFromMessages(messages, context);
  printMatchLoudLists({ unmatchedLikelyDemo, ambiguous });
  console.log(`matched imported demo messages: ${matched.length}`);

  const plan = compactTagPlan(matched);
  stageArray('__TAGPLAN', plan);

  const started = startTagExecutor();
  console.log(`started tag executor: ${JSON.stringify(started)}`);
  const tagResult = await pollTagResult(plan.length);
  printFailures(tagResult.failures);

  const expectedByMatter = buildExpectedByMatter(matched);
  const sampleRows = sampleExpectedMatterRows(
    expectedByMatter,
    VERIFY_SAMPLE_SIZE
  );

  console.log('\nVERIFY sample clients:');
  for (const row of sampleRows) {
    const count = await listMatterCountViaBridge(row.matterId);
    console.log(
      `  ${row.matterName} (${row.householdSlug}) -> ${count} messages by matter; ${row.expectedMatched} matched this run`
    );
  }

  console.log('\nTOTAL TAGGED SUMMARY');
  console.log(`  mail store messages read: ${messages.length}/${total}`);
  console.log(`  outbox messages available: ${outboxRecords.length}`);
  console.log(`  matched demo messages: ${matched.length}`);
  console.log(`  already ok: ${Number(tagResult.alreadyOk || 0)}`);
  console.log(`  newly tagged: ${Number(tagResult.newlyTagged || 0)}`);
  console.log(
    `  unmatched loud: ${unmatchedLikelyDemo.length + ambiguous.length}`
  );
  console.log(`  unmatched likely demo messages: ${unmatchedLikelyDemo.length}`);
  console.log(`  ambiguous matches skipped: ${ambiguous.length}`);
  console.log(`  failures: ${Number(tagResult.failureCount || 0)}`);
  if (tagResult.error) console.log(`  executor error: ${tagResult.error}`);

  exitCode =
    Number(tagResult.failureCount || 0) > 0 ||
    Boolean(tagResult.error) ||
    ambiguous.length > 0 ||
    unmatchedLikelyDemo.length > 0
      ? 1
      : 0;
} catch (error) {
  exitCode = 1;
  console.error(`LOUD BRIDGE TAGGER ERROR: ${error?.stack || error}`);
} finally {
  process.exitCode = exitCode;
}
