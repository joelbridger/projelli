#!/usr/bin/env node
// Resend only full-practice demo emails that are absent from the Legion mail store.
//
// Store reads go through the debug bridge on the Windows bench. Sending mirrors
// /home/jameson/lantern-demo-data/full-practice/tools/send_outbox.py.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = '/home/jameson/lantern-demo-data/full-practice';
const OUTBOX_DIR = path.join(ROOT, 'emails/outbox');
const LOG_DIR = path.join(ROOT, 'logs');
const RESENT_LOG = path.join(LOG_DIR, 'resent.log');
const RESEND_ERRORS_LOG = path.join(LOG_DIR, 'resend-errors.log');
const DEFAULT_BREVO_ENV =
  '/tmp/claude-1000/-home-jameson/f66b4b21-fe63-4699-a8db-b4bbe0523db7/scratchpad/brevo.env';

const LEGION = process.env.LEGION_SSH || 'james@100.127.67.22';
const BRIDGE_BASE = 'http://127.0.0.1:9250';
const SSH_CONNECT_TIMEOUT_SEC = 8;
const BRIDGE_TIMEOUT_SEC = 20;
const MAIL_PAGE_SIZE = Number(process.env.BRIDGE_MAIL_PAGE_SIZE || 8);
const MAX_ENCODED_EVAL_CHARS = Number(
  process.env.BRIDGE_EVAL_MAX_CHARS || 3000
);
const SEND_DELAY_MS = Number(process.env.BREVO_RESEND_DELAY_MS || 4000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeEmail(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const angleMatch = raw.match(/<([^>]+)>/);
  return (angleMatch?.[1] || raw).trim();
}

function normalizeSubject(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceKey(fromEmail, subject) {
  return `${normalizeEmail(fromEmail)}\u0000${normalizeSubject(subject)}`;
}

function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function compactText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function snippetMatches(message, outbox) {
  const snippet = compactText(message.snippet);
  const body = compactText(outbox.email?.body);
  if (!snippet || !body) return false;
  const snippetNeedle = snippet.slice(0, Math.min(80, snippet.length));
  const bodyNeedle = body.slice(0, Math.min(80, body.length));
  return body.includes(snippetNeedle) || snippet.includes(bodyNeedle);
}

function redactForLog(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function readMaybeSet(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function appendLine(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${line}\n`, 'utf8');
}

async function loadOutbox() {
  const files = (await fs.readdir(OUTBOX_DIR))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const records = [];

  for (const file of files) {
    const fullPath = path.join(OUTBOX_DIR, file);
    const data = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    const emails = Array.isArray(data) ? data : data?.emails;
    if (!Array.isArray(emails)) {
      throw new Error(`Outbox file is not an email array: ${fullPath}`);
    }

    emails.forEach((email, index) => {
      const fromEmail = normalizeEmail(email.from_email);
      const subject = normalizeSubject(email.subject);
      if (!fromEmail || !subject) {
        throw new Error(
          `Outbox message is missing from_email or subject: ${file}#${index}`
        );
      }

      records.push({
        id: `${file}#${index}`,
        householdFile: file,
        householdSlug: path.basename(file, '.json'),
        index,
        fromEmail,
        subject,
        date: dateOnly(email.date),
        email,
        key: evidenceKey(fromEmail, subject),
      });
    });
  }

  return records;
}

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
    await sleep(500);
  }
}

async function readMailPage(offset, limit) {
  const varName = bridgeVarName('MAILPAGE');
  const js = `(()=>{const v='${varName}',I=window.__TAURI__?.core?.invoke||window.__TAURI__?.invoke;window[v]={done:false};if(!I){window[v]={done:true,ok:false,error:'Tauri invoke bridge is not available'};return true;}I('mail_list_messages',{query:{sortBy:'date',sortDesc:true,limit:${limit},offset:${offset}}}).then(x=>{const a=Array.isArray(x?.items)?x.items:[];window[v]={done:true,ok:true,result:{total:Number(x?.total??a.length),items:a.map(m=>({id:String(m?.id||''),fromAddr:String(m?.fromAddr||''),fromName:String(m?.fromName||''),subject:String(m?.subject||''),receivedDateTime:m?.receivedDateTime||'',snippet:String(m?.snippet||'').slice(0,160)}))}}}).catch(e=>{window[v]={done:true,ok:false,error:String(e?.message||e)}});return true;})()`;
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

function groupByKey(rows) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.key) || [];
    list.push(row);
    map.set(row.key, list);
  }
  return map;
}

function sortOutboxForStableMatching(rows) {
  return [...rows].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate) return byDate;
    return a.id.localeCompare(b.id);
  });
}

function computeMissingOutbox(outboxRecords, storeMessages) {
  const storeRecords = storeMessages
    .map((message) => ({
      id: String(message?.id || ''),
      fromEmail: normalizeEmail(message?.fromAddr),
      subject: normalizeSubject(message?.subject),
      date: dateOnly(message?.receivedDateTime),
      snippet: String(message?.snippet || ''),
      key: evidenceKey(message?.fromAddr, message?.subject),
    }))
    .filter((message) => message.fromEmail && message.subject);

  const storeByKey = groupByKey(storeRecords);
  const missing = [];
  const ambiguous = [];

  for (const [key, outboxGroupRaw] of groupByKey(outboxRecords)) {
    const outboxGroup = sortOutboxForStableMatching(outboxGroupRaw);
    const storeGroup = [...(storeByKey.get(key) || [])];

    if (storeGroup.length === 0) {
      missing.push(...outboxGroup);
      continue;
    }

    if (outboxGroup.length === 1) continue;

    const unmatchedOutbox = new Set(outboxGroup.map((row) => row.id));
    const unmatchedStore = new Set(storeGroup.map((row, index) => index));

    for (const outbox of outboxGroup) {
      if (!outbox.date) continue;
      const storeIndex = storeGroup.findIndex(
        (store, index) => unmatchedStore.has(index) && store.date === outbox.date
      );
      if (storeIndex >= 0) {
        unmatchedOutbox.delete(outbox.id);
        unmatchedStore.delete(storeIndex);
      }
    }

    for (const outbox of outboxGroup) {
      if (!unmatchedOutbox.has(outbox.id)) continue;
      const storeIndex = storeGroup.findIndex(
        (store, index) =>
          unmatchedStore.has(index) && snippetMatches(store, outbox)
      );
      if (storeIndex >= 0) {
        unmatchedOutbox.delete(outbox.id);
        unmatchedStore.delete(storeIndex);
      }
    }

    const remainingOutbox = outboxGroup.filter((row) =>
      unmatchedOutbox.has(row.id)
    );
    if (remainingOutbox.length === 0) continue;

    const remainingStoreCount = unmatchedStore.size;
    if (remainingStoreCount >= remainingOutbox.length) continue;

    if (remainingStoreCount === 0) {
      missing.push(...remainingOutbox);
      continue;
    }

    ambiguous.push({
      key,
      missingCount: remainingOutbox.length - remainingStoreCount,
      outbox: remainingOutbox,
      store: [...unmatchedStore].map((index) => storeGroup[index]),
    });
  }

  return { missing: sortOutboxForStableMatching(missing), ambiguous };
}

async function loadBrevoApiKey() {
  if (process.env.BREVO_API_KEY?.trim()) {
    return process.env.BREVO_API_KEY.trim();
  }

  const envPath = process.env.BREVO_ENV || DEFAULT_BREVO_ENV;
  const text = await fs.readFile(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?BREVO_API_KEY=(.*)\s*$/);
    if (!match) continue;
    const raw = match[1].trim();
    return raw.replace(/^['"]|['"]$/g, '').trim();
  }

  throw new Error('BREVO_API_KEY is not set');
}

async function sendBrevoEmail(record, apiKey) {
  const email = record.email;
  const payload = {
    sender: { name: email.from_name, email: email.from_email },
    to: [
      {
        email: email.to_email || 'sarah.morgan.cfp@outlook.com',
        name: email.to_name || 'Sarah Morgan',
      },
    ],
    subject: email.subject,
    textContent: email.body,
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Brevo HTTP ${response.status}: ${redactForLog(responseText || response.statusText)}`
    );
  }

  return responseText ? JSON.parse(responseText) : {};
}

function printMissingList(missing) {
  console.log('\nUNDELIVERED OUTBOX MESSAGES:');
  if (missing.length === 0) {
    console.log('  none');
    return;
  }
  for (const record of missing) {
    const dateSuffix = record.date ? ` | ${record.date}` : '';
    console.log(`  ${record.householdFile} | ${record.subject}${dateSuffix}`);
  }
}

async function main() {
  console.log(`bridge health: ${JSON.stringify(bridgeHealth())}`);

  const outboxRecords = await loadOutbox();
  const { items: storeMessages, total } = await listAllMessagesViaBridge();
  console.log(`outbox messages read: ${outboxRecords.length}`);
  console.log(`mail store messages read: ${storeMessages.length}/${total}`);

  const { missing, ambiguous } = computeMissingOutbox(
    outboxRecords,
    storeMessages
  );
  printMissingList(missing);

  if (ambiguous.length > 0) {
    console.error('\nAMBIGUOUS DUPLICATE MATCHES:');
    for (const row of ambiguous) {
      console.error(
        `  missing ${row.missingCount} from duplicate group: ${row.outbox
          .map((entry) => `${entry.householdFile}#${entry.index}`)
          .join(', ')}`
      );
    }
    throw new Error('Refusing to resend because duplicate matching is ambiguous');
  }

  const alreadyResent = await readMaybeSet(RESENT_LOG);
  const toSend = missing.filter((record) => !alreadyResent.has(record.id));
  const skipped = missing.length - toSend.length;
  if (skipped > 0) {
    console.log(`already recorded in resent.log, not resent again: ${skipped}`);
  }

  const apiKey = await loadBrevoApiKey();
  let resent = 0;
  let failed = 0;

  for (const [index, record] of toSend.entries()) {
    if (index > 0) await sleep(SEND_DELAY_MS);
    try {
      const result = await sendBrevoEmail(record, apiKey);
      resent += 1;
      await appendLine(RESENT_LOG, record.id);
      console.log(
        `resent ${resent}/${toSend.length}: ${record.householdFile} | ${record.subject} | ${result.messageId || 'accepted'}`
      );
    } catch (error) {
      failed += 1;
      await appendLine(
        RESEND_ERRORS_LOG,
        `${new Date().toISOString()} ${record.id} ${redactForLog(error?.message || error)}`
      );
      console.error(
        `send failed: ${record.householdFile} | ${record.subject} | ${redactForLog(error?.message || error)}`
      );
    }
  }

  console.log('\nRESEND SUMMARY');
  console.log(`undelivered count: ${missing.length}`);
  console.log(`resent count: ${resent}`);
  console.log(`already resent count: ${skipped}`);
  console.log(`failed count: ${failed}`);

  if (failed > 0) {
    throw new Error(`${failed} resend request(s) failed`);
  }
}

try {
  await main();
  console.log('DONE-EXIT:0');
} catch (error) {
  console.error(`RESEND MISSING DEMO MAIL ERROR: ${error?.stack || error}`);
  process.exitCode = 1;
}
