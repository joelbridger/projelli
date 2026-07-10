// Tag each imported full-practice demo email to its intended client matter.
//
// Source of truth:
// - roster/households.json maps household slug -> household display name
// - emails/outbox/<household-slug>.json maps each generated email -> household slug
//
// Matching rule:
// - exact (from_email, subject), with date/snippet tiebreakers only if a
//   generated-data collision appears
// - never sender address alone, because the roster intentionally has duplicate
//   client email addresses
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPage, disconnect } from '../robot/connection.mjs';

const ROSTER_PATH =
  '/home/jameson/lantern-demo-data/full-practice/roster/households.json';
const OUTBOX_DIR =
  '/home/jameson/lantern-demo-data/full-practice/emails/outbox';
const PAGE_SIZE = 250;
const VERIFY_SAMPLE_SIZE = 5;

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

function compactText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function basenameAnyPlatform(value) {
  return (
    String(value || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ''
  );
}

function parseStoredMatters(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const matters = parsed?.state?.matters ?? parsed?.matters ?? [];
  if (!Array.isArray(matters)) return [];
  return matters
    .map((matter) => ({
      id: String(matter.id || ''),
      name: String(matter.name || matter.title || ''),
      client: String(matter.client || ''),
      folderPaths: Array.isArray(matter.folderPaths) ? matter.folderPaths : [],
      mailFolderPaths: Array.isArray(matter.mailFolderPaths)
        ? matter.mailFolderPaths
        : [],
    }))
    .filter((matter) => matter.id);
}

function parseMailFolderKey(key) {
  const value = String(key || '').trim();
  const firstSlash = value.indexOf('/');
  if (firstSlash <= 0) return null;
  const provider = value.slice(0, firstSlash);
  const rest = value.slice(firstSlash + 1);
  if (!provider || !rest) return null;
  const secondSlash = rest.indexOf('/');
  if (secondSlash < 0) return { provider, account: rest, folderId: '' };
  const account = rest.slice(0, secondSlash);
  const folderId = rest.slice(secondSlash + 1);
  if (!account) return null;
  return { provider, account, folderId };
}

function buildMailMatterMap(matters) {
  const map = [];
  for (const matter of matters) {
    if (matter.id === 'unassigned') continue;
    for (const key of matter.mailFolderPaths || []) {
      const parsed = parseMailFolderKey(key);
      if (parsed) map.push({ ...parsed, matterId: matter.id });
    }
  }
  return map;
}

function matterSlugCandidates(matter) {
  const candidates = new Set();
  for (const value of [matter.name, matter.client]) {
    const slug = slugify(value);
    if (slug) candidates.add(slug);
  }
  for (const folderPath of matter.folderPaths || []) {
    const slug = slugify(basenameAnyPlatform(folderPath));
    if (slug) candidates.add(slug);
  }
  const idSlugs = [
    matter.id,
    matter.id.replace(/^matter[_-]/, ''),
    matter.id.replace(/^matter[_-]nc[_-]/, ''),
    matter.id.replace(/^matter[_-]full[_-]/, ''),
  ];
  for (const value of idSlugs) {
    const slug = slugify(String(value).replace(/_/g, '-'));
    if (slug) candidates.add(slug);
  }
  return candidates;
}

function buildMatterBySlug(matters, households) {
  const matterCandidates = new Map();
  const duplicateMatterSlugs = new Map();
  for (const matter of matters) {
    for (const slug of matterSlugCandidates(matter)) {
      if (
        matterCandidates.has(slug) &&
        matterCandidates.get(slug).id !== matter.id
      ) {
        duplicateMatterSlugs.set(slug, [matterCandidates.get(slug), matter]);
        continue;
      }
      matterCandidates.set(slug, matter);
    }
  }

  const bySlug = new Map();
  const missing = [];
  for (const household of households) {
    const slug = String(
      household.slug || slugify(household.folder || household.name)
    ).trim();
    if (!slug) continue;
    const candidates = [
      slug,
      slugify(household.folder),
      slugify(household.name),
    ].filter(Boolean);
    const matter = candidates
      .map((candidate) => matterCandidates.get(candidate))
      .find(Boolean);
    if (matter) bySlug.set(slug, matter);
    else missing.push({ slug, name: household.name || household.folder || '' });
  }

  return { bySlug, missing, duplicateMatterSlugs };
}

async function loadRoster() {
  const data = JSON.parse(await fs.readFile(ROSTER_PATH, 'utf8'));
  if (!Array.isArray(data))
    throw new Error(`Roster is not a JSON array: ${ROSTER_PATH}`);
  return data;
}

async function loadOutbox(householdsBySlug) {
  const files = (await fs.readdir(OUTBOX_DIR))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const records = [];
  const missingRoster = [];

  for (const file of files) {
    const householdSlug = path.basename(file, '.json');
    const household = householdsBySlug.get(householdSlug);
    if (!household) missingRoster.push(householdSlug);

    const filePath = path.join(OUTBOX_DIR, file);
    const messages = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!Array.isArray(messages))
      throw new Error(`Outbox file is not a JSON array: ${filePath}`);

    messages.forEach((message, index) => {
      const fromEmail = normalizeEmail(message.from_email);
      const subject = normalizeSubject(message.subject);
      if (!fromEmail || !subject) {
        console.log(
          `LOUD UNMATCHABLE OUTBOX: missing from_email/subject in ${file} #${index + 1}`
        );
        return;
      }
      records.push({
        householdSlug,
        householdName: household?.name || household?.folder || householdSlug,
        file,
        index,
        fromEmail,
        subject,
        date: dateOnly(message.date),
        body: String(message.body || ''),
        key: evidenceKey(fromEmail, subject),
      });
    });
  }

  return { records, missingRoster };
}

function indexOutbox(records, matterBySlug) {
  const byEvidence = new Map();
  const fromEmails = new Set();
  const missingMatter = [];

  for (const record of records) {
    fromEmails.add(record.fromEmail);
    const matter = matterBySlug.get(record.householdSlug);
    const enriched = {
      ...record,
      matterId: matter?.id || null,
      matterName: matter?.name || record.householdName,
    };
    if (!matter) missingMatter.push(record);
    const list = byEvidence.get(record.key) || [];
    list.push(enriched);
    byEvidence.set(record.key, list);
  }

  return { byEvidence, fromEmails, missingMatter };
}

function snippetMatches(message, candidate) {
  const snippet = compactText(message.snippet);
  const body = compactText(candidate.body);
  if (!snippet || !body) return false;
  const snippetNeedle = snippet.slice(0, Math.min(80, snippet.length));
  const bodyNeedle = body.slice(0, Math.min(80, body.length));
  return body.includes(snippetNeedle) || snippet.includes(bodyNeedle);
}

function chooseOutboxCandidate(message, candidates) {
  if (candidates.length === 1)
    return { candidate: candidates[0], reason: 'exact from_email + subject' };

  const messageDate = dateOnly(message.receivedDateTime);
  if (messageDate) {
    const byDate = candidates.filter(
      (candidate) => candidate.date && candidate.date === messageDate
    );
    if (byDate.length === 1)
      return {
        candidate: byDate[0],
        reason: 'exact from_email + subject + date',
      };
  }

  const bySnippet = candidates.filter((candidate) =>
    snippetMatches(message, candidate)
  );
  if (bySnippet.length === 1)
    return {
      candidate: bySnippet[0],
      reason: 'exact from_email + subject + snippet',
    };

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score:
        Number(candidate.date && candidate.date === messageDate) +
        Number(snippetMatches(message, candidate)),
    }))
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score > 0 && scored[0].score > scored[1]?.score) {
    return {
      candidate: scored[0].candidate,
      reason: 'exact from_email + subject + best date/snippet score',
    };
  }

  return {
    candidate: null,
    reason: `ambiguous generated evidence (${candidates.length} outbox candidates)`,
  };
}

async function invoke(page, command, args) {
  return page.evaluate(
    async ({ command: cmd, args: invokeArgs }) => {
      if (!window.__TAURI__?.core?.invoke)
        throw new Error('Tauri invoke bridge is not available');
      return window.__TAURI__.core.invoke(cmd, invokeArgs);
    },
    { command, args }
  );
}

async function listAllMessages(page) {
  const items = [];
  let offset = 0;
  let total = null;

  for (;;) {
    const result = await invoke(page, 'mail_list_messages', {
      query: { sortBy: 'date', sortDesc: true, limit: PAGE_SIZE, offset },
    });
    const pageItems = Array.isArray(result?.items) ? result.items : [];
    if (total == null) total = Number(result?.total ?? pageItems.length);
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

async function getCurrentMatterId(page, messageId) {
  const view = await invoke(page, 'mail_get_message', { id: messageId });
  return view?.matterId || null;
}

async function listMatterCount(page, matterId, matterMap) {
  const result = await invoke(page, 'mail_list_messages_by_matter', {
    matterId,
    matterMap,
    query: { sortBy: 'date', sortDesc: true, limit: 1, offset: 0 },
  });
  return Number(result?.total ?? 0);
}

function messageLabel(message) {
  return `${message.fromName || ''} <${message.fromAddr || ''}> | ${message.subject || ''} | ${message.receivedDateTime || ''}`;
}

function printLoudList(title, rows, formatRow, limit = 40) {
  if (rows.length === 0) return;
  console.log(`\nLOUD ${title}: ${rows.length}`);
  rows.slice(0, limit).forEach((row) => console.log(`  ${formatRow(row)}`));
  if (rows.length > limit) console.log(`  ... ${rows.length - limit} more`);
}

const page = await getPage();
let exitCode = 0;

try {
  const [roster, appState] = await Promise.all([
    loadRoster(),
    page.evaluate(() => ({
      mattersRaw: localStorage.getItem('keepance:matters') || '',
    })),
  ]);

  const householdsBySlug = new Map(
    roster.map((household) => [String(household.slug || ''), household])
  );
  const { records: outboxRecords, missingRoster } =
    await loadOutbox(householdsBySlug);
  const matters = parseStoredMatters(appState.mattersRaw);
  const matterMap = buildMailMatterMap(matters);
  const {
    bySlug: matterBySlug,
    missing: rosterWithoutMatter,
    duplicateMatterSlugs,
  } = buildMatterBySlug(matters, roster);
  const { byEvidence, fromEmails, missingMatter } = indexOutbox(
    outboxRecords,
    matterBySlug
  );

  console.log(`loaded roster households: ${roster.length}`);
  console.log(`loaded outbox messages: ${outboxRecords.length}`);
  console.log(`loaded app matters: ${matters.length}`);
  console.log(`loaded app mail-folder mappings: ${matterMap.length}`);

  printLoudList(
    'OUTBOX FILES WITH NO ROSTER ROW',
    missingRoster,
    (slug) => slug
  );
  printLoudList(
    'ROSTER HOUSEHOLDS WITH NO APP MATTER',
    rosterWithoutMatter,
    (row) => `${row.slug} | ${row.name}`
  );
  printLoudList(
    'OUTBOX MESSAGES WITH NO APP MATTER',
    missingMatter,
    (row) => `${row.householdSlug} | ${row.fromEmail} | ${row.subject}`
  );
  printLoudList(
    'DUPLICATE MATTER SLUG CANDIDATES',
    [...duplicateMatterSlugs.entries()],
    ([slug, pair]) =>
      `${slug} -> ${pair.map((matter) => `${matter.name} (${matter.id})`).join(' | ')}`
  );

  const collisions = [...byEvidence.values()].filter((list) => list.length > 1);
  printLoudList('GENERATED EVIDENCE COLLISIONS', collisions, (list) =>
    list.map((row) => `${row.householdSlug}:${row.index + 1}`).join(' | ')
  );

  const { items: messages, total } = await listAllMessages(page);
  console.log(`mail store messages read: ${messages.length}/${total}`);

  const matched = [];
  const unmatchedLikelyDemo = [];
  const ambiguous = [];

  for (const message of messages) {
    const key = evidenceKey(message.fromAddr, message.subject);
    const candidates = byEvidence.get(key) || [];
    const fromEmail = normalizeEmail(message.fromAddr);

    if (candidates.length === 0) {
      if (
        fromEmails.has(fromEmail) ||
        /@jamesondaines\.com$/i.test(fromEmail)
      ) {
        unmatchedLikelyDemo.push(message);
      }
      continue;
    }

    const choice = chooseOutboxCandidate(message, candidates);
    if (!choice.candidate) {
      ambiguous.push({ message, candidates, reason: choice.reason });
      continue;
    }

    if (!choice.candidate.matterId) {
      unmatchedLikelyDemo.push({
        ...message,
        missingMatterSlug: choice.candidate.householdSlug,
      });
      continue;
    }

    matched.push({
      message,
      outbox: choice.candidate,
      matterId: choice.candidate.matterId,
      reason: choice.reason,
    });
  }

  printLoudList(
    'UNMATCHED LIKELY DEMO MAIL STORE MESSAGES',
    unmatchedLikelyDemo,
    (message) => {
      const missingMatterSuffix = message.missingMatterSlug
        ? ` | no app matter for ${message.missingMatterSlug}`
        : '';
      return `${messageLabel(message)}${missingMatterSuffix}`;
    }
  );
  printLoudList(
    'AMBIGUOUS MAIL STORE MATCHES',
    ambiguous,
    ({ message, candidates, reason }) =>
      `${messageLabel(message)} | ${reason} | ${candidates.map((row) => row.householdSlug).join(', ')}`
  );

  console.log(`matched imported demo messages: ${matched.length}`);

  let alreadyCorrect = 0;
  let retagged = 0;
  let failed = 0;

  for (const entry of matched) {
    try {
      const currentMatterId = await getCurrentMatterId(page, entry.message.id);
      if (currentMatterId === entry.matterId) {
        alreadyCorrect += 1;
        continue;
      }
      await invoke(page, 'mail_retag_message_matter', {
        messageId: entry.message.id,
        matterId: entry.matterId,
      });
      retagged += 1;
      console.log(
        `tagged ${entry.outbox.householdSlug.padEnd(32)} -> ${entry.matterId} | ${entry.message.subject}`
      );
    } catch (error) {
      failed += 1;
      console.log(
        `LOUD TAG ERROR: ${entry.outbox.householdSlug} | ${entry.message.id} | ${String(error).slice(0, 240)}`
      );
    }
  }

  const expectedByMatter = new Map();
  for (const entry of matched) {
    const current = expectedByMatter.get(entry.matterId) || {
      matterId: entry.matterId,
      matterName: entry.outbox.matterName,
      householdSlug: entry.outbox.householdSlug,
      expectedMatched: 0,
    };
    current.expectedMatched += 1;
    expectedByMatter.set(entry.matterId, current);
  }

  console.log('\nVERIFY sample clients:');
  const sampleRows = [...expectedByMatter.values()]
    .sort((a, b) => a.matterName.localeCompare(b.matterName))
    .slice(0, VERIFY_SAMPLE_SIZE);
  for (const row of sampleRows) {
    const count = await listMatterCount(page, row.matterId, matterMap);
    console.log(
      `  ${row.matterName} (${row.householdSlug}) -> ${count} messages by matter; ${row.expectedMatched} matched this run`
    );
  }

  let totalTaggedByMatter = 0;
  for (const row of expectedByMatter.values()) {
    totalTaggedByMatter += await listMatterCount(page, row.matterId, matterMap);
  }

  console.log('\nTOTAL TAGGED SUMMARY');
  console.log(`  mail store messages read: ${messages.length}/${total}`);
  console.log(`  outbox messages available: ${outboxRecords.length}`);
  console.log(`  matched demo messages: ${matched.length}`);
  console.log(`  already correctly filed: ${alreadyCorrect}`);
  console.log(`  newly tagged: ${retagged}`);
  console.log(
    `  unmatched likely demo messages: ${unmatchedLikelyDemo.length}`
  );
  console.log(`  ambiguous matches skipped: ${ambiguous.length}`);
  console.log(`  tag errors: ${failed}`);
  console.log(
    `  total messages visible across matched demo matters now: ${totalTaggedByMatter}`
  );

  exitCode =
    failed > 0 || ambiguous.length > 0 || unmatchedLikelyDemo.length > 0
      ? 1
      : 0;
} finally {
  await disconnect().catch(() => {});
}

process.exitCode = exitCode;
