#!/usr/bin/env node
/**
 * One-time (re-runnable) data-prep script for the web-ui-seed dev bootstrap.
 *
 * Reads the read-only synthetic practice fixture at
 * /home/jameson/lantern-demo-data/full-practice/ (factsheets JSON files — a
 * per-household distillation of wealthbox-contacts-raw.json, already keyed by
 * folder/slug; each household's Meetings meeting.json; emails/outbox JSON)
 * and writes a single committed data bundle to
 * src/web-ui-seed/data/households.generated.json for all 80 households.
 *
 * This script is NOT part of the app bundle — it runs once at prep time via
 * `node scripts/build-web-ui-seed-data.mjs`. The runtime dev seeder
 * (src/web-ui-seed/WebUiSeedBootstrap.ts) only ever reads the generated JSON.
 *
 * Tier selection: every 5th household (alphabetical) is "full" (~15 of 80) —
 * gets extra documents, an email thread, and a meeting folder written into
 * OPFS at seed time. The rest are "light" — one overview document only. This
 * keeps browser storage bounded while giving spot-checks real depth.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SOURCE_ROOT = '/home/jameson/lantern-demo-data/full-practice';
const OUT_PATH = path.resolve(
  import.meta.dirname,
  '../src/web-ui-seed/data/households.generated.json',
);

function slugFolder(folder) {
  return folder;
}

function loadFactsheets() {
  const dir = path.join(SOURCE_ROOT, 'factsheets');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

function loadMeeting(folder) {
  const meetingsDir = path.join(SOURCE_ROOT, 'clients', folder, 'Meetings');
  if (!existsSync(meetingsDir)) return null;
  const entries = readdirSync(meetingsDir).filter((name) =>
    existsSync(path.join(meetingsDir, name, 'meeting.json')),
  );
  if (entries.length === 0) return null;
  // Deterministic: newest folder name (dated prefix) sorts last.
  const chosen = entries.sort()[entries.length - 1];
  const meetingJson = JSON.parse(
    readFileSync(path.join(meetingsDir, chosen, 'meeting.json'), 'utf8'),
  );
  return { folderName: chosen, meta: meetingJson };
}

function loadEmails(slug) {
  const file = path.join(SOURCE_ROOT, 'emails', 'outbox', `${slug}.json`);
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  // Oldest-first for a natural thread read order; cap at 6.
  return raw
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-6)
    .map((e) => ({
      date: e.date,
      subject: e.subject,
      fromName: e.from_name,
      fromEmail: e.from_email,
      toName: e.to_name,
      toEmail: e.to_email,
      body: e.body,
    }));
}

function buildClientName(householdName) {
  // "Abernathy, George & Pam" -> "Abernathy"
  const comma = householdName.indexOf(',');
  return (comma === -1 ? householdName : householdName.slice(0, comma)).trim();
}

function main() {
  const factsheets = loadFactsheets();
  if (factsheets.length !== 80) {
    console.warn(`[build-web-ui-seed-data] expected 80 factsheets, found ${String(factsheets.length)}`);
  }

  const households = factsheets.map((fs, index) => {
    const folder = fs.folder;
    const slug = fs.slug;
    const tier = index % 5 === 0 ? 'full' : 'light';
    const meeting = tier === 'full' ? loadMeeting(folder) : null;
    const emails = tier === 'full' ? loadEmails(slug) : [];

    return {
      id: `webseed-${slug}`,
      folderName: slugFolder(folder),
      name: fs.household,
      client: buildClientName(fs.household),
      slug,
      tier,
      segment: fs.segment ?? '',
      custodian: fs.custodian ?? '',
      risk: fs.risk ?? '',
      aumTotal: fs.aum_total ?? null,
      members: (fs.members ?? []).map((m) => ({
        name: m.name,
        born: m.born ?? null,
        email: m.email ?? '',
        role: m.role ?? '',
      })),
      accounts: (fs.accounts ?? []).map((a) => ({
        type: a.type,
        owner: a.owner,
        balance: a.balance,
        numberMasked: a.number_masked ?? '',
      })),
      goals: fs.goals ?? [],
      concerns: fs.concerns ?? [],
      storylines: fs.storylines ?? [],
      timeline: fs.timeline ?? [],
      family: fs.family ?? '',
      meeting: meeting
        ? {
            folderName: meeting.folderName,
            matterIdPlaceholder: '{MATTER_ID}',
            startedAt: meeting.meta.startedAt,
            durationMs: meeting.meta.durationMs ?? null,
            calendarTitle: meeting.meta.calendarTitle ?? '',
            customTitle: meeting.meta.customTitle ?? '',
            typeId: meeting.meta.typeId ?? 'annual-review',
            reviewedAt: meeting.meta.reviewedAt ?? null,
            consent: meeting.meta.consent ?? null,
            calendarEvent: meeting.meta.calendarEvent ?? null,
          }
        : null,
      emails,
    };
  });

  const fullCount = households.filter((h) => h.tier === 'full').length;
  const lightCount = households.length - fullCount;

  const out = {
    version: 1,
    generatedAt: '2026-07-13',
    sourceNote:
      'Derived from /home/jameson/lantern-demo-data/full-practice/factsheets/*.json ' +
      '(a per-household distillation of wealthbox-contacts-raw.json), ' +
      'clients/*/Meetings/*/meeting.json, and emails/outbox/*.json. Dev-only fixture; never shipped.',
    counts: { households: households.length, full: fullCount, light: lightCount },
    households,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${String(households.length)} households (${String(fullCount)} full, ${String(lightCount)} light) to ${OUT_PATH}`);
}

main();
