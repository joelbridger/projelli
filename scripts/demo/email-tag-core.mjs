// Shared matching logic for filing imported full-practice demo email to matters.
//
// The safe matching rule is exact (from_email, subject), with date/snippet only
// as tiebreakers when the generated demo data has a collision. Sender-only is
// intentionally never enough because demo clients can share an email address.
import fs from 'node:fs/promises';
import path from 'node:path';

export const ROSTER_PATH =
  '/home/jameson/lantern-demo-data/full-practice/roster/households.json';
export const OUTBOX_DIR =
  '/home/jameson/lantern-demo-data/full-practice/emails/outbox';
export const PAGE_SIZE = 250;
export const VERIFY_SAMPLE_SIZE = 5;

export function normalizeEmail(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const angleMatch = raw.match(/<([^>]+)>/);
  return (angleMatch?.[1] || raw).trim();
}

export function normalizeSubject(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function evidenceKey(fromEmail, subject) {
  return `${normalizeEmail(fromEmail)}\u0000${normalizeSubject(subject)}`;
}

export function compactText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function basenameAnyPlatform(value) {
  return (
    String(value || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ''
  );
}

export function parseStoredMatters(raw) {
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

export function parseMailFolderKey(key) {
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

export function buildMailMatterMap(matters) {
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

export function matterSlugCandidates(matter) {
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

export function buildMatterBySlug(matters, households) {
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

export async function loadRoster(rosterPath = ROSTER_PATH) {
  const data = JSON.parse(await fs.readFile(rosterPath, 'utf8'));
  if (!Array.isArray(data))
    throw new Error(`Roster is not a JSON array: ${rosterPath}`);
  return data;
}

export function buildHouseholdsBySlug(roster) {
  return new Map(
    roster.map((household) => [String(household.slug || ''), household])
  );
}

export async function loadOutbox(householdsBySlug, outboxDir = OUTBOX_DIR) {
  const files = (await fs.readdir(outboxDir))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const records = [];
  const missingRoster = [];

  for (const file of files) {
    const householdSlug = path.basename(file, '.json');
    const household = householdsBySlug.get(householdSlug);
    if (!household) missingRoster.push(householdSlug);

    const filePath = path.join(outboxDir, file);
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

export function indexOutbox(records, matterBySlug) {
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

export function snippetMatches(message, candidate) {
  const snippet = compactText(message.snippet);
  const body = compactText(candidate.body);
  if (!snippet || !body) return false;
  const snippetNeedle = snippet.slice(0, Math.min(80, snippet.length));
  const bodyNeedle = body.slice(0, Math.min(80, body.length));
  return body.includes(snippetNeedle) || snippet.includes(bodyNeedle);
}

export function chooseOutboxCandidate(message, candidates) {
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

export function buildTaggingContext(roster, outboxRecords, matters) {
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
  const collisions = [...byEvidence.values()].filter(
    (list) => list.length > 1
  );

  return {
    matterMap,
    matterBySlug,
    rosterWithoutMatter,
    duplicateMatterSlugs,
    byEvidence,
    fromEmails,
    missingMatter,
    collisions,
  };
}

export function buildTagPlanFromMessages(messages, context) {
  const matched = [];
  const unmatchedLikelyDemo = [];
  const ambiguous = [];

  for (const message of messages) {
    const key = evidenceKey(message.fromAddr, message.subject);
    const candidates = context.byEvidence.get(key) || [];
    const fromEmail = normalizeEmail(message.fromAddr);

    if (candidates.length === 0) {
      if (
        context.fromEmails.has(fromEmail) ||
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

  return { matched, unmatchedLikelyDemo, ambiguous };
}

export function compactTagPlan(matched) {
  return matched.map((entry) => ({
    messageId: String(entry.message.id || ''),
    matterId: entry.matterId,
  }));
}

export function buildExpectedByMatter(matched) {
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
  return expectedByMatter;
}

export function sampleExpectedMatterRows(
  expectedByMatter,
  size = VERIFY_SAMPLE_SIZE
) {
  return [...expectedByMatter.values()]
    .sort((a, b) => a.matterName.localeCompare(b.matterName))
    .slice(0, size);
}

export function messageLabel(message) {
  return `${message.fromName || ''} <${message.fromAddr || ''}> | ${message.subject || ''} | ${message.receivedDateTime || ''}`;
}

export function printLoudList(title, rows, formatRow, limit = 40) {
  if (rows.length === 0) return;
  console.log(`\nLOUD ${title}: ${rows.length}`);
  rows.slice(0, limit).forEach((row) => console.log(`  ${formatRow(row)}`));
  if (rows.length > limit) console.log(`  ... ${rows.length - limit} more`);
}

export function printPreparationLoudLists({
  missingRoster,
  context,
  limit = 40,
}) {
  printLoudList(
    'OUTBOX FILES WITH NO ROSTER ROW',
    missingRoster,
    (slug) => slug,
    limit
  );
  printLoudList(
    'ROSTER HOUSEHOLDS WITH NO APP MATTER',
    context.rosterWithoutMatter,
    (row) => `${row.slug} | ${row.name}`,
    limit
  );
  printLoudList(
    'OUTBOX MESSAGES WITH NO APP MATTER',
    context.missingMatter,
    (row) => `${row.householdSlug} | ${row.fromEmail} | ${row.subject}`,
    limit
  );
  printLoudList(
    'DUPLICATE MATTER SLUG CANDIDATES',
    [...context.duplicateMatterSlugs.entries()],
    ([slug, pair]) =>
      `${slug} -> ${pair.map((matter) => `${matter.name} (${matter.id})`).join(' | ')}`,
    limit
  );
  printLoudList('GENERATED EVIDENCE COLLISIONS', context.collisions, (list) =>
    list.map((row) => `${row.householdSlug}:${row.index + 1}`).join(' | ')
  );
}

export function printMatchLoudLists({ unmatchedLikelyDemo, ambiguous }) {
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
}
