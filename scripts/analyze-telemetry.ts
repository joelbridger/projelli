#!/usr/bin/env bun
/**
 * analyze-telemetry.ts
 *
 * Reads the JSONL files that the form-handler writes for the Keepance
 * desktop app's opt-in telemetry and email signups, and prints a funnel
 * digest to stdout.
 *
 * Sources (one-line-JSON-object-per-line):
 *   ~/keepance/sign-ups/keepance-telemetry-event-YYYY-MM.jsonl
 *   ~/keepance/sign-ups/keepance-in-app-onboarding-signup-YYYY-MM.jsonl
 *
 * Each row looks like:
 *   { received_at, site, form, form_id, ip, user_agent, referer, fields: { ... } }
 *
 * Telemetry `fields` carries: install_id, app_version, platform, event,
 * license_tier?, days_since_install?
 *
 * Signup `fields` carries: email, source
 *
 * Outputs a digest covering three windows (7d, 30d, all-time):
 *   - Unique installs (distinct install_id)
 *   - Event counts by name
 *   - Conversion funnel (installs → trial_start → trial_end → license_activated)
 *   - Email signups
 *
 * Usage:
 *   bun ~/keepance/scripts/analyze-telemetry.ts            # print to stdout
 *   bun ~/keepance/scripts/analyze-telemetry.ts --email    # also email via Brevo (uses /etc/form-handler.env)
 *   bun ~/keepance/scripts/analyze-telemetry.ts --json     # JSON output (for piping to jq / other tools)
 */

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const HOME = homedir();
const SIGNUPS_DIR = path.join(HOME, 'keepance', 'sign-ups');

type Row = {
  received_at: string;
  form_id: string;
  fields: Record<string, string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [
  { key: '7d', label: 'Last 7 days', cutoffMs: 7 * DAY_MS },
  { key: '30d', label: 'Last 30 days', cutoffMs: 30 * DAY_MS },
  { key: 'all', label: 'All time', cutoffMs: Infinity },
] as const;

const TELEMETRY_PREFIX = 'keepance-telemetry-event-';
const SIGNUP_PREFIX = 'keepance-in-app-onboarding-signup-';

async function readJsonlFiles(prefix: string): Promise<Row[]> {
  let entries: string[];
  try {
    entries = await readdir(SIGNUPS_DIR);
  } catch {
    return [];
  }
  const rows: Row[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.jsonl')) continue;
    const raw = await readFile(path.join(SIGNUPS_DIR, entry), 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as Row);
      } catch {
        // skip malformed lines
      }
    }
  }
  return rows;
}

interface WindowMetrics {
  uniqueInstalls: number;
  eventCounts: Record<string, number>;
  uniqueByEvent: Record<string, number>;
  signups: number;
  funnel: {
    installs: number;
    trialStarted: number;
    trialEnded: number;
    licensesActivated: number;
    licensesDeactivated: number;
  };
}

function computeWindow(
  events: Row[],
  signups: Row[],
  cutoffMs: number
): WindowMetrics {
  const now = Date.now();
  const inWindow = (r: Row) => now - new Date(r.received_at).getTime() <= cutoffMs;

  const filteredEvents = events.filter(inWindow);
  const filteredSignups = signups.filter(inWindow);

  const eventCounts: Record<string, number> = {};
  const uniqueByEvent: Record<string, Set<string>> = {};
  const installIds = new Set<string>();

  for (const row of filteredEvents) {
    const event = row.fields?.event ?? 'unknown';
    const installId = row.fields?.install_id ?? 'unknown';
    installIds.add(installId);
    eventCounts[event] = (eventCounts[event] ?? 0) + 1;
    if (!uniqueByEvent[event]) uniqueByEvent[event] = new Set();
    uniqueByEvent[event]!.add(installId);
  }

  const uniqueByEventCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(uniqueByEvent)) {
    uniqueByEventCounts[k] = v.size;
  }

  return {
    uniqueInstalls: installIds.size,
    eventCounts,
    uniqueByEvent: uniqueByEventCounts,
    signups: filteredSignups.length,
    funnel: {
      installs: installIds.size,
      // Use unique counts for funnel rates so a chatty client doesn't skew %s.
      trialStarted: uniqueByEventCounts['trial_start'] ?? 0,
      trialEnded: uniqueByEventCounts['trial_end'] ?? 0,
      licensesActivated: uniqueByEventCounts['license_activated'] ?? 0,
      licensesDeactivated: uniqueByEventCounts['license_deactivated'] ?? 0,
    },
  };
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '   —';
  const v = (numerator / denominator) * 100;
  return v.toFixed(1).padStart(4) + '%';
}

function formatDigest(metrics: Record<string, WindowMetrics>): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`KEEPANCE TELEMETRY DIGEST — ${today}`);
  lines.push('=' .repeat(48));
  lines.push('');

  for (const win of WINDOWS) {
    const m = metrics[win.key]!;
    const f = m.funnel;
    lines.push(win.label);
    lines.push('-'.repeat(win.label.length));
    lines.push(`  Unique installs (distinct install_id):  ${String(m.uniqueInstalls).padStart(5)}`);
    lines.push(`  app_launch events:                       ${String(m.eventCounts['app_launch'] ?? 0).padStart(5)}`);
    lines.push(`  trial_start (unique installs):           ${String(f.trialStarted).padStart(5)}`);
    lines.push(`  trial_end (unique installs):             ${String(f.trialEnded).padStart(5)}`);
    lines.push(`  license_activated (unique installs):     ${String(f.licensesActivated).padStart(5)}`);
    lines.push(`  license_deactivated (unique installs):   ${String(f.licensesDeactivated).padStart(5)}`);
    lines.push(`  Email signups:                           ${String(m.signups).padStart(5)}`);
    lines.push('');
    lines.push(`  Conversion funnel (unique installs)`);
    lines.push(`    Installs:           ${String(f.installs).padStart(5)}            (baseline)`);
    lines.push(`    Trial started:      ${String(f.trialStarted).padStart(5)}   →  ${pct(f.trialStarted, f.installs)}`);
    lines.push(`    Trial ended:        ${String(f.trialEnded).padStart(5)}   →  ${pct(f.trialEnded, f.installs)}`);
    lines.push(`    License activated:  ${String(f.licensesActivated).padStart(5)}   →  ${pct(f.licensesActivated, f.installs)}`);
    lines.push('');
  }

  lines.push('-'.repeat(48));
  lines.push('Notes:');
  lines.push('  • Unique counts deduplicate by install_id so a chatty client');
  lines.push('    cannot skew the funnel.');
  lines.push('  • Telemetry is opt-in. The numbers above represent the');
  lines.push('    subset of users who consented at first launch — actual');
  lines.push('    install/conversion totals are higher.');
  lines.push('  • Email signups are independent of telemetry consent. A');
  lines.push('    user can give one without the other.');
  lines.push('');
  lines.push(`Source files: ${SIGNUPS_DIR}`);
  return lines.join('\n');
}

async function loadBrevoKey(): Promise<string | null> {
  try {
    const env = await readFile('/etc/form-handler.env', 'utf-8');
    for (const line of env.split('\n')) {
      const m = line.match(/^BREVO_API_KEY=(.+)$/);
      if (m) return m[1]!.trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // not readable
  }
  return process.env['BREVO_API_KEY'] ?? null;
}

async function emailDigest(body: string): Promise<void> {
  const key = await loadBrevoKey();
  if (!key) {
    console.error('email: BREVO_API_KEY not found (looked in /etc/form-handler.env and env). Skipping send.');
    return;
  }
  const recipient = process.env['DIGEST_TO'] ?? 'jamesondaines@outlook.com';
  const subject = `Keepance telemetry — ${new Date().toISOString().slice(0, 10)}`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Keepance', email: 'noreply@keepance.com' },
      to: [{ email: recipient }],
      subject,
      textContent: body,
    }),
  });
  if (!res.ok) {
    console.error(`email: Brevo POST failed (${res.status}): ${await res.text()}`);
    return;
  }
  console.error(`email: digest sent to ${recipient}`);
}

async function main() {
  const args = process.argv.slice(2);
  const wantEmail = args.includes('--email');
  const wantJson = args.includes('--json');

  const events = await readJsonlFiles(TELEMETRY_PREFIX);
  const signups = await readJsonlFiles(SIGNUP_PREFIX);

  const metrics: Record<string, WindowMetrics> = {};
  for (const win of WINDOWS) {
    metrics[win.key] = computeWindow(events, signups, win.cutoffMs);
  }

  if (wantJson) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  const body = formatDigest(metrics);
  console.log(body);

  if (wantEmail) {
    await emailDigest(body);
  }
}

main().catch((err) => {
  console.error('analyze-telemetry failed:', err);
  process.exit(1);
});
