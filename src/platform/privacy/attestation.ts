// One-click attestation report (Wave 4 Track D): who consented when, what was
// recorded, what was deleted when — from the hash-chained audit log + the
// per-client consent ledgers. Output is a real .docx (Word-native rule).

export interface ConsentReportRow { client: string; confirmedAt: string; mode: string; scope: string; note: string }
export interface EventRow { timestamp: string; description: string }
export interface AttestationInput {
  workspaceName: string;
  generatedAt: string;
  policyLabel: string;
  integrityLine: string;
  consent: ConsentReportRow[];
  recordings: EventRow[];
  deletions: EventRow[];
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/—/g, '-').replace(/\n/g, ' ');
}

export function buildAttestationMarkdown(input: AttestationInput): string {
  const lines: string[] = [];
  lines.push('# Recording and Retention Attestation');
  lines.push('');
  lines.push(`**Practice:** ${esc(input.workspaceName)}`);
  lines.push(`**Generated:** ${input.generatedAt}`);
  lines.push(`**Retention policy:** ${esc(input.policyLabel)}`);
  lines.push(`**${esc(input.integrityLine)}**`);
  lines.push('');
  lines.push('All recordings, transcripts, and voice profiles referenced below were created and stored only on this computer. Nothing was uploaded to a recording vendor.');
  lines.push('');
  lines.push('## Consent on file');
  if (input.consent.length === 0) {
    lines.push('No consent events recorded.');
  } else {
    lines.push('| Client | Confirmed | Mode | Scope | Note |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const c of input.consent) {
      lines.push(`| ${esc(c.client)} | ${c.confirmedAt} | ${esc(c.mode)} | ${esc(c.scope)} | ${esc(c.note)} |`);
    }
  }
  lines.push('');
  lines.push('## Recordings');
  if (input.recordings.length === 0) {
    lines.push('No recordings logged.');
  } else {
    lines.push('| When | Event |');
    lines.push('| --- | --- |');
    for (const r of input.recordings) lines.push(`| ${r.timestamp} | ${esc(r.description)} |`);
  }
  lines.push('');
  lines.push('## Deletions');
  if (input.deletions.length === 0) {
    lines.push('No deletions logged.');
  } else {
    lines.push('| When | Event |');
    lines.push('| --- | --- |');
    for (const d of input.deletions) lines.push(`| ${d.timestamp} | ${esc(d.description)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

const RECORDING_ACTIONS = new Set(['meeting_capture_started', 'meeting_recorded']);
const DELETION_ACTIONS = new Set(['meeting_audio_deleted', 'retention_delete', 'file_delete']);

export async function exportAttestationDocx(workspaceRoot: string): Promise<string> {
  const { auditList, auditVerifyIntegrity } = await import('@/platform/utils/tauri-commands');
  const entries = await auditList();
  const verdict = await auditVerifyIntegrity();
  const integrityLine = !verdict
    ? 'Audit log integrity: not available in this environment'
    : verdict.status === 'verified'
      ? `Audit log integrity: verified (${String(verdict.checked)} entries checked)`
      : `Audit log integrity: ALTERED entry detected at sequence ${String(verdict.seq)} (${verdict.reason}), see the audit screen`;

  const recordings: EventRow[] = [];
  const deletions: EventRow[] = [];
  for (const e of entries) {
    if (RECORDING_ACTIONS.has(e.action)) recordings.push({ timestamp: e.timestamp, description: e.description });
    else if (DELETION_ACTIONS.has(e.action) && (e.description.includes('Meetings/') || e.action !== 'file_delete')) {
      deletions.push({ timestamp: e.timestamp, description: e.description });
    }
  }

  // Consent ledgers: one JSON per matter folder (Wave 3 Task 13). Read
  // directly via the Tauri fs plugin — the same call TauriFSBackend makes
  // under the hood — since consent-ledger reads happen outside any component
  // that holds a WorkspaceService instance.
  const { getMatters } = await import('@/platform/matter/matterStore');
  const { toWorkspaceRelativeFolder } = await import('@/platform/rag/matterResolver');
  const fs = await import('@tauri-apps/plugin-fs');
  const consent: ConsentReportRow[] = [];
  for (const m of getMatters()) {
    for (const folder of m.folderPaths) {
      const rel = toWorkspaceRelativeFolder(folder, workspaceRoot);
      if (!rel) continue;
      try {
        const raw = await fs.readTextFile(`${workspaceRoot}/${rel}/Meetings/.consent-ledger.json`);
        const parsed = JSON.parse(raw) as { entries?: Array<{ mode?: string; scope?: string; confirmedAt?: string; note?: string }> };
        for (const c of parsed.entries ?? []) {
          consent.push({ client: m.client, confirmedAt: c.confirmedAt ?? '', mode: c.mode ?? '', scope: c.scope ?? '', note: c.note ?? '' });
        }
      } catch {
        // no ledger for this folder — fine
      }
    }
  }

  const { useRetentionPolicyStore, sanitizePolicy } = await import('./retentionPolicyStore');
  const { retentionPolicyLabel } = await import('@/features/settings/RetentionSettings');
  const i18n = (await import('@/i18n')).default;
  const policyLabel = retentionPolicyLabel(
    sanitizePolicy(useRetentionPolicyStore.getState().policies[workspaceRoot]),
    i18n.t.bind(i18n),
  );

  const md = buildAttestationMarkdown({
    workspaceName: workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace',
    generatedAt: new Date().toISOString(),
    policyLabel,
    integrityLine,
    consent,
    recordings,
    deletions,
  });

  const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
  const fileName = `Attestation Report ${new Date().toISOString().slice(0, 10)}.docx`;
  const bytes = await markdownToDocxBytes(md, fileName);
  const outPath = `${workspaceRoot}/${fileName}`;
  await fs.writeFile(outPath, bytes);
  return outPath;
}
