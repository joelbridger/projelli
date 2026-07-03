// Pure cross-source beneficiary consistency checks. Typed findings only —
// rendering, storage, and dismissal live elsewhere. Deliberately conservative:
// one finding per rule, silence when evidence agrees or is insufficient.
import type { GapQuestion, SourceRef } from '@/platform/clientMap/types';
import type { EstateDocEvidence } from './estateDocs';

export type BeneficiaryFindingKind = 'MISMATCH' | 'STALE' | 'MISSING';
export interface BeneficiaryFinding { kind: BeneficiaryFindingKind; text: string; sources: SourceRef[] }

const HONEST_LIMITS = 'Flagged for your review. Not legal advice.';
const NEEDS_DESIGNATION = /\b(rollover\s+IRA|IRA|Roth\s+IRA|401\(?k\)?|403\(?b\)?|annuity|life\s+insurance)\b/i;

export function beneficiaryConsistency(ev: {
  estate: EstateDocEvidence[];
  accountMentions: { account: string; source: SourceRef }[];
  lifeEvents: { event: string; dateIso: string | null }[];
}): BeneficiaryFinding[] {
  const findings: BeneficiaryFinding[] = [];

  // MISMATCH: two estate sources that both name parties, but the sets differ.
  const named = ev.estate.filter((e) => e.parties.length > 0);
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = named[i];
      const b = named[j];
      if (!a || !b) continue;
      const overlap = a.parties.some((p) => b.parties.includes(p));
      if (!overlap) {
        findings.push({
          kind: 'MISMATCH',
          text: `Two documents name different beneficiaries: ${a.parties.join(', ')} (${a.kind}) vs ${b.parties.join(', ')} (${b.kind}).`,
          sources: [a.source, b.source],
        });
      }
    }
  }

  // STALE: a dated life event AFTER the newest dated estate document.
  const dated = ev.estate.filter((e): e is EstateDocEvidence & { docDateIso: string } => e.docDateIso !== null);
  if (dated.length > 0) {
    const newest = dated.reduce((x, y) => (x.docDateIso > y.docDateIso ? x : y));
    for (const le of ev.lifeEvents) {
      if (le.dateIso && le.dateIso > newest.docDateIso) {
        findings.push({
          kind: 'STALE',
          text: `A life event (${le.event}, ${le.dateIso}) postdates the newest estate document on file (${newest.kind}, ${newest.docDateIso}).`,
          sources: [newest.source],
        });
        break; // one STALE finding is enough
      }
    }
  }

  // MISSING: designation-needing accounts mentioned, but no designation doc anywhere.
  const hasDesignation = ev.estate.some((e) => e.kind === 'beneficiary-designation');
  if (!hasDesignation) {
    const needing = ev.accountMentions.filter((a) => NEEDS_DESIGNATION.test(a.account));
    const [first] = needing;
    if (first) {
      findings.push({
        kind: 'MISSING',
        text: `A ${first.account} is mentioned but no beneficiary designation is on file.`,
        sources: needing.map((a) => a.source),
      });
    }
  }
  return findings;
}

export function beneficiaryGapQuestions(findings: BeneficiaryFinding[]): GapQuestion[] {
  return findings.map((f) => ({
    sectionKey: 'household',
    text: `Beneficiary check: ${f.text} ${HONEST_LIMITS}`,
  }));
}
