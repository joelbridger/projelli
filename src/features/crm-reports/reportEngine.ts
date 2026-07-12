import type { FilterClause, ReportKind, ViewQuery } from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export interface ReportRow {
  householdId: string;
  householdName: string;
  values: Record<string, string>;
  sourceIds: readonly string[];
  group?: string;
}
export interface ComputedReport {
  kind: ReportKind;
  title: string;
  rows: readonly ReportRow[];
  sourcesConsidered: number;
  exclusions: readonly string[];
  calculatedAt: string;
}

export const REPORT_TITLES: Record<ReportKind, string> = {
  no_contact_6mo: 'No contact in 6 months',
  attention_vs_fee: 'Attention versus fee',
  birthdays: 'Upcoming birthdays',
  age_65: 'Turning 65',
  rmd_due: 'RMD due',
  review_due: 'Review due',
  custom: 'Custom report',
};

/** Extra display choices are deliberately data only, never an executable query. */
export type ReportQuery = ViewQuery & { fields?: readonly string[] };

export const REPORTABLE_FIELDS = [
  'name',
  'status',
  'serviceTier',
  'primaryAdvisor',
  'nextReviewDue',
  'lastContactAt',
  'activityCount',
] as const;

type Household = LiveCrmRecord & { name?: string };

function asDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function iso(value: Date | undefined): string {
  return value ? value.toISOString().slice(0, 10) : 'Not recorded';
}

function householdIdFor(record: LiveCrmRecord): string | undefined {
  if (typeof record['householdId'] === 'string') return record['householdId'];
  const reference = record['householdRef'];
  if (reference && typeof reference === 'object' && typeof (reference as { id?: unknown }).id === 'string') return (reference as { id: string }).id;
  const target = record['targetRef'];
  if (target && typeof target === 'object' && (target as { kind?: unknown }).kind === 'household' && typeof (target as { id?: unknown }).id === 'string') return (target as { id: string }).id;
  return undefined;
}

function displayName(record: LiveCrmRecord): string {
  if (typeof record['name'] === 'string' && record['name'].trim()) return record['name'];
  const first = typeof record['firstName'] === 'string' ? record['firstName'] : '';
  const last = typeof record['lastName'] === 'string' ? record['lastName'] : '';
  return `${first} ${last}`.trim() || 'Unnamed person';
}

function ageOn(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayThisYear = new Date(Date.UTC(now.getUTCFullYear(), birthDate.getUTCMonth(), birthDate.getUTCDate()));
  if (birthdayThisYear > now) age -= 1;
  return age;
}

function upcomingBirthday(birthDate: Date, now: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), birthDate.getUTCMonth(), birthDate.getUTCDate()));
  if (next < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))) next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

function moneyValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') return undefined;
  if (typeof (value as { amount?: unknown }).amount === 'number') return (value as { amount: number }).amount;
  if (typeof (value as { value?: unknown }).value === 'number') return (value as { value: number }).value;
  return undefined;
}

function feeFor(household: Household, facts: readonly LiveCrmRecord[]): number | undefined {
  for (const key of ['annualFee', 'annual_fee', 'fee']) {
    const direct = moneyValue(household[key]);
    if (direct !== undefined) return direct;
  }
  const fields = household['customFields'];
  if (fields && typeof fields === 'object') {
    for (const key of ['annualFee', 'annual_fee', 'fee']) {
      const entry = (fields as Record<string, unknown>)[key];
      const value = entry && typeof entry === 'object' ? (entry as { value?: unknown }).value : entry;
      const fee = moneyValue(value);
      if (fee !== undefined) return fee;
    }
  }
  for (const fact of facts) {
    const label = typeof fact['label'] === 'string' ? fact['label'].toLowerCase() : '';
    if (label.includes('fee')) {
      const fee = moneyValue(fact['value']);
      if (fee !== undefined) return fee;
    }
  }
  return undefined;
}

function applies(value: unknown, filter: FilterClause): boolean {
  const normalized = value === undefined || value === null ? '' : String(value).toLowerCase();
  const target = Array.isArray(filter.value) ? filter.value.map(String).map((item) => item.toLowerCase()) : String(filter.value ?? '').toLowerCase();
  if (filter.op === 'is_empty') return !normalized;
  if (filter.op === 'is_not_empty') return Boolean(normalized);
  if (filter.op === 'contains') return normalized.includes(String(target));
  if (filter.op === 'in') return Array.isArray(target) && target.includes(normalized);
  if (filter.op === 'eq') return normalized === String(target);
  if (filter.op === 'neq') return normalized !== String(target);
  if (filter.op === 'before' || filter.op === 'after') {
    const left = asDate(normalized)?.getTime(); const right = asDate(String(target))?.getTime();
    return left !== undefined && right !== undefined && (filter.op === 'before' ? left < right : left > right);
  }
  return false;
}

function customRows(households: readonly Household[], query: ReportQuery, activities: readonly LiveCrmRecord[]): ReportRow[] {
  const mapped = households.map((household) => {
    const householdActivities = activities.filter((activity) => householdIdFor(activity) === household.id);
    const lastContact = householdActivities.map((activity) => asDate(activity['at'])).filter((date): date is Date => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      household,
      fields: {
        name: displayName(household),
        status: String(household['status'] ?? household['lifecycle'] ?? ''),
        serviceTier: String(household['serviceTier'] ?? ''),
        primaryAdvisor: String(household['primaryAdvisor'] ?? ''),
        nextReviewDue: String(household['nextReviewDue'] ?? household['nextReview'] ?? ''),
        lastContactAt: iso(lastContact),
        activityCount: String(householdActivities.length),
      } as Record<string, string>,
      sourceIds: [household.id, ...householdActivities.map((activity) => activity.id)],
    };
  }).filter(({ fields }) => query.filters.every((filter) => applies(fields[filter.field], filter)));
  const sorted = [...mapped];
  for (const sort of [...(query.sort ?? [])].reverse()) sorted.sort((left, right) => (left.fields[sort.field] ?? '').localeCompare(right.fields[sort.field] ?? '') * (sort.dir === 'desc' ? -1 : 1));
  const visibleFields = query.fields?.length ? query.fields : REPORTABLE_FIELDS;
  return sorted.map(({ household, fields, sourceIds }) => ({
    householdId: household.id,
    householdName: fields['name'] ?? displayName(household),
    values: Object.fromEntries(visibleFields.filter((field) => field !== 'name').map((field) => [field, fields[field] ?? 'Not recorded'])),
    sourceIds,
    ...(query.groupBy ? { group: fields[query.groupBy] || 'Not recorded' } : {}),
  }));
}

/** Computes from the currently decrypted records. It intentionally never saves results. */
export function computeReport(records: readonly LiveCrmRecord[], kind: ReportKind, query: ReportQuery = { entity: 'household', filters: [] }, now = new Date()): ComputedReport {
  const households = records.filter((record): record is Household => record.kind === 'household');
  const activities = records.filter((record) => record.kind === 'activityEvent');
  const people = records.filter((record) => record.kind === 'person');
  const facts = records.filter((record) => record.kind === 'fact');
  const policies = records.filter((record) => record.kind === 'servicePolicy');
  // Saved recipes and prior run receipts describe reports; they are not client
  // records the current answer was calculated from. Counting them made the
  // on-screen provenance grow every time an advisor re-ran the same report.
  const sourcesConsidered = records.filter((record) => !['savedView', 'savedReport', 'reportRun'].includes(record.kind)).length;
  const rows: ReportRow[] = [];
  const exclusions: string[] = [];
  const contactCutoff = new Date(now); contactCutoff.setUTCDate(contactCutoff.getUTCDate() - 183);

  if (kind === 'custom') rows.push(...customRows(households, query, activities));
  if (kind === 'no_contact_6mo') for (const household of households) {
    const contacts = activities.filter((activity) => householdIdFor(activity) === household.id).map((activity) => asDate(activity['at'])).filter((date): date is Date => Boolean(date));
    const latest = contacts.sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latest || latest < contactCutoff) rows.push({ householdId: household.id, householdName: displayName(household), values: { lastContact: iso(latest), serviceTier: String(household['serviceTier'] ?? 'Not recorded') }, sourceIds: [household.id, ...activities.filter((activity) => householdIdFor(activity) === household.id).map((activity) => activity.id)] });
  }
  if (kind === 'attention_vs_fee') for (const household of households) {
    const householdActivities = activities.filter((activity) => householdIdFor(activity) === household.id);
    const householdFacts = facts.filter((fact) => householdIdFor(fact) === household.id);
    const fee = feeFor(household, householdFacts);
    rows.push({ householdId: household.id, householdName: displayName(household), values: { attention: `${String(householdActivities.length)} recorded activities`, fee: fee === undefined ? 'No fee data recorded' : `$${fee.toLocaleString()}`, comparison: fee === undefined ? 'Cannot compare attention to a fee that is not recorded' : `${(householdActivities.length / Math.max(fee, 1) * 1000).toFixed(2)} activities per $1,000` }, sourceIds: [household.id, ...householdActivities.map((item) => item.id), ...householdFacts.map((item) => item.id)] });
    if (fee === undefined) exclusions.push(`${displayName(household)} has no fee data. No estimate was made.`);
  }
  if (kind === 'birthdays' || kind === 'age_65' || kind === 'rmd_due') for (const person of people) {
    const birthDate = asDate(person['birthDate']); if (!birthDate) continue;
    const householdId = householdIdFor(person) ?? (Array.isArray(person['householdIds']) && typeof person['householdIds'][0] === 'string' ? person['householdIds'][0] : undefined);
    const household = households.find((item) => item.id === householdId);
    const name = displayName(person);
    const age = ageOn(birthDate, now);
    const nextBirthday = upcomingBirthday(birthDate, now);
    const days = Math.ceil((nextBirthday.getTime() - now.getTime()) / 86_400_000);
    const qualifies = kind === 'birthdays' ? days <= 31 : kind === 'age_65' ? age === 64 || (age === 65 && days <= 365) : age >= 73;
    if (qualifies) rows.push({ householdId: household?.id ?? person.id, householdName: household ? displayName(household) : name, values: { person: name, birthDate: iso(birthDate), age: String(age), ...(kind === 'birthdays' ? { nextBirthday: iso(nextBirthday) } : {}), ...(kind === 'rmd_due' ? { rmd: 'Review required. The firm records eligibility and account details before acting.' } : {}) }, sourceIds: [person.id, ...(household ? [household.id] : [])] });
  }
  if (kind === 'review_due') for (const household of households) {
    const policy = policies.find((item) => item['scope'] === 'household-override' && item['appliesToHouseholdIds'] && Array.isArray(item['appliesToHouseholdIds']) && item['appliesToHouseholdIds'].includes(household.id)) ?? policies.find((item) => Array.isArray(item['appliesToHouseholdIds']) && item['appliesToHouseholdIds'].includes(household.id));
    const due = asDate(household['nextReviewDue'] ?? household['nextReview'] ?? policy?.['nextReviewDue']);
    if (!due) { exclusions.push(`${displayName(household)} has no next review date recorded.`); continue; }
    if (due <= new Date(now.getTime() + 31 * 86_400_000)) rows.push({ householdId: household.id, householdName: displayName(household), values: { nextReviewDue: iso(due), serviceTier: String(household['serviceTier'] ?? policy?.['tierName'] ?? 'Not recorded') }, sourceIds: [household.id, ...(policy ? [policy.id] : [])] });
  }
  if (kind === 'attention_vs_fee') rows.sort((a, b) => Number.parseFloat(b.values['comparison'] ?? '') - Number.parseFloat(a.values['comparison'] ?? ''));
  return { kind, title: REPORT_TITLES[kind], rows, sourcesConsidered, exclusions, calculatedAt: now.toISOString() };
}

/** The local Ask handoff deliberately proposes a bounded query, never executes or saves it. */
export function proposeReportFromQuestion(question: string): { kind: ReportKind; query: ViewQuery; explanation: string } {
  const lower = question.toLowerCase();
  if (lower.includes('birthday')) return { kind: 'birthdays', query: { entity: 'person', filters: [] }, explanation: 'Upcoming birthdays from recorded birth dates.' };
  if (lower.includes('65')) return { kind: 'age_65', query: { entity: 'person', filters: [] }, explanation: 'People who are turning 65 from recorded birth dates.' };
  if (lower.includes('rmd')) return { kind: 'rmd_due', query: { entity: 'person', filters: [] }, explanation: 'People age 73 or older. Eligibility still needs a person to review.' };
  if (lower.includes('fee') || lower.includes('attention')) return { kind: 'attention_vs_fee', query: { entity: 'household', filters: [] }, explanation: 'Recorded activity compared only with recorded fees. Missing fees stay missing.' };
  if (lower.includes('review')) return { kind: 'review_due', query: { entity: 'household', filters: [] }, explanation: 'Households with a recorded review date due within 31 days.' };
  if (lower.includes('contact') || lower.includes('neglect')) return { kind: 'no_contact_6mo', query: { entity: 'household', filters: [] }, explanation: 'Households without a recorded activity in the last six months.' };
  return { kind: 'custom', query: { entity: 'household', filters: [] }, explanation: 'A blank household report. Add the filters you want before running or saving it.' };
}
