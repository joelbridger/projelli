/**
 * Northstar Ridge is deliberately fake.  It is a deterministic, ugly data set
 * for scale tests only: none of these people, firms, phone numbers, accounts,
 * or notes represent a real person or client.
 */

export const BIG_FIRM_SEED = 'northstar-ridge-fabricated-v1';
export const BIG_FIRM_MARKER = 'FABRICATED SCALE FIXTURE — NOT REAL CLIENT DATA';

const COUNTS = Object.freeze({
  seats: 10,
  households: 320,
  activities: 3_600,
  tasks: 720,
  workflows: 420,
});

function rng(seed = BIG_FIRM_SEED) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const firstNames = ['Avery', 'Noël', 'Mina', 'José', 'Renée', 'Wei', 'Dávid', 'Zoë', 'Sanjay', 'Élodie', 'Marta', 'Kai', 'Léa', 'Omar', 'Tess', 'Ирина'];
const lastNames = ['Bramble', 'Bramble', 'Nguyễn', 'O’Malley', 'García', 'Müller', 'Sato', 'Kowalski', 'Davis', 'Davis-Smith', 'Åström', 'Petrović', 'Núñez', 'Lee', 'Patel', 'Example'];
const advisors = ['Maya Patel', 'Jon Bell', 'Nora Chen', 'Eli Brooks', 'Sam Rivera', 'Iris Stein', 'Theo Park', 'Ada Morgan', 'Luis Kwon', 'Bea Fox'];
const eventVerbs = ['review completed', 'left voicemail', 'document requested', 'email bounced', 'beneficiary question logged', 'tax packet received', 'meeting rescheduled', 'legacy import corrected'];

function pick(random, values) { return values[Math.floor(random() * values.length)]; }
function isoDay(day) { return new Date(Date.UTC(2016, 0, 1) + day * 86_400_000).toISOString(); }
function shortId(prefix, value) { return `${prefix}-${String(value).padStart(5, '0')}`; }

function householdName(index) {
  const last = lastNames[index % lastNames.length];
  const first = firstNames[(index * 7) % firstNames.length];
  // Intentional near-duplicates that resemble an old CRM after migrations.
  if (index % 41 === 0) return `${last} Family`;
  if (index % 37 === 0) return `${last} family `;
  if (index % 29 === 0) return `${first} ${last} & Household`;
  return `${first} ${last} Household`;
}

function longNote(index) {
  const detail = `This is fabricated historical note ${index}. It contains stale advice, a corrected spelling, and a deliberately awkward imported paragraph. `;
  return index % 19 === 0
    ? `${BIG_FIRM_MARKER}. ${detail.repeat(180)}Important: never send the old “wire” template. 🧵\n\nImported from an obsolete system; owner unknown.`
    : `${BIG_FIRM_MARKER}. ${detail}The family asked for a follow-up after their annual review. 😀`;
}

/** Returns plain CRM records that must be persisted only through crm_live_upsert. */
export function createBigFirmCorpus(seed = BIG_FIRM_SEED) {
  const random = rng(seed);
  const records = [];
  const householdIds = [];

  for (let seat = 0; seat < COUNTS.seats; seat += 1) {
    records.push({ id: `seat-${seat + 1}`, kind: 'firmDirectoryEntry', matterId: 'firm_home', userId: `seat-${seat + 1}`, displayName: advisors[seat], title: seat === 0 ? 'Principal' : 'Advisor', active: true, fixture: BIG_FIRM_MARKER });
  }

  for (let index = 0; index < COUNTS.households; index += 1) {
    const id = shortId('household', index + 1);
    householdIds.push(id);
    const members = index % 43 === 0 ? 8 : 1 + Math.floor(random() * 4);
    const createdAt = isoDay(Math.floor(random() * 3650));
    records.push({
      id, kind: 'household', matterId: id, name: householdName(index), lifecycle: index % 17 === 0 ? 'Former client' : 'Active',
      primaryAdvisor: pick(random, advisors), serviceTier: ['Platinum', 'Gold', 'Silver', 'Legacy', ''][index % 5],
      annualFee: index % 23 === 0 ? undefined : 800 + (index % 9) * 425, nextReviewDue: index % 31 === 0 ? undefined : isoDay(3600 + index).slice(0, 10),
      members: Array.from({ length: members }, (_, member) => ({ id: `${id}-member-${member + 1}`, name: `${firstNames[(index + member) % firstNames.length]} ${lastNames[(index * 3 + member) % lastNames.length]}`, relationship: member === 0 ? 'Primary' : member === 1 ? 'Spouse' : 'Related person' })),
      notes: [{ id: `${id}-note`, body: longNote(index), audience: 'internal', createdAt }],
      tags: index % 11 === 0 ? ['legacy-import', 'needs-review'] : index % 7 === 0 ? ['🧾 tax', 'Unicode'] : [],
      customFields: index % 13 === 0 ? { legacyHouseholdCode: `L-${1000 + index}`, source: 'Old CRM export' } : {},
      fixture: BIG_FIRM_MARKER,
      ...(index % 79 === 0 ? { deletedAt: isoDay(2400 + index), restoredAt: isoDay(2440 + index), restoreReason: 'Accidental merge reversed' } : {}),
    });
    for (let person = 0; person < members; person += 1) {
      records.push({ id: `${id}-person-${person + 1}`, kind: 'person', matterId: id, householdId: id, firstName: firstNames[(index + person) % firstNames.length], lastName: lastNames[(index * 5 + person) % lastNames.length], birthDate: `${1940 + ((index + person) % 55)}-${String(1 + ((index + person) % 12)).padStart(2, '0')}-15`, roles: person % 5 === 0 ? ['beneficiary', 'CPA'] : ['household member'], fixture: BIG_FIRM_MARKER });
    }
  }

  for (let index = 0; index < COUNTS.activities; index += 1) {
    const householdId = householdIds[index % householdIds.length];
    records.push({ id: shortId('activity', index + 1), kind: 'activityEvent', matterId: 'firm_home', householdId, at: isoDay((index * 3) % 3650), actor: { displayName: advisors[index % advisors.length] }, verb: 'crm.imported_activity', summary: `${pick(random, eventVerbs)} for ${householdId} (${BIG_FIRM_MARKER})`, targetRef: index % 47 === 0 ? { kind: 'legacy_note', id: `missing-note-${index}`, label: 'Deleted legacy note (orphaned link)' } : { kind: 'household', id: householdId }, important: index % 97 === 0, fixture: BIG_FIRM_MARKER });
  }

  for (let index = 0; index < COUNTS.tasks; index += 1) {
    const householdId = householdIds[index % householdIds.length];
    records.push({ id: shortId('task', index + 1), kind: 'task', matterId: 'firm_home', householdRef: { kind: 'household', id: householdId, matterId: householdId }, title: index % 53 === 0 ? `Investigate Bramble duplicate record ${index}` : `Fabricated follow-up ${index}: ${pick(random, eventVerbs)}`, body: index % 67 === 0 ? longNote(index) : `Fabricated task detail ${index}.`, assigneeUserId: `seat-${(index % COUNTS.seats) + 1}`, status: index % 7 === 0 ? 'done' : index % 11 === 0 ? 'blocked' : 'open', priority: index % 13 === 0 ? 'high' : 'normal', due: isoDay(3450 + (index % 450)).slice(0, 10), fixture: BIG_FIRM_MARKER });
  }

  for (let index = 0; index < COUNTS.workflows; index += 1) {
    const householdId = householdIds[index % householdIds.length];
    records.push({ id: shortId('workflow', index + 1), kind: 'workflowInstance', matterId: householdId, householdId, householdLabel: householdName(index % COUNTS.households), name: index % 3 === 0 ? 'Annual review (legacy)' : 'Fabricated service workflow', status: index % 5 === 0 ? 'completed' : 'open', createdAt: isoDay((index * 8) % 3650), snapshot: { steps: { intake: { stepId: 'intake', status: index % 4 === 0 ? 'done' : 'open', titleSnapshot: 'Confirm household details', assigneeUserId: `seat-${(index % COUNTS.seats) + 1}`, hiddenByTemplateRemoval: false }, review: { stepId: 'review', status: 'open', titleSnapshot: 'Review 10 years of history', hiddenByTemplateRemoval: false } } }, fixture: BIG_FIRM_MARKER });
  }

  records.push({ id: 'orphaned-link-00001', kind: 'legacyLink', matterId: 'firm_home', householdId: 'household-99999', title: 'Orphaned link from a deleted household', targetRef: { kind: 'household', id: 'household-99999' }, fixture: BIG_FIRM_MARKER });
  return Object.freeze({ seed, marker: BIG_FIRM_MARKER, counts: { ...COUNTS, records: records.length }, records: Object.freeze(records), targetHouseholdId: 'household-00001', targetHouseholdName: householdName(0), searchNeedle: 'Bramble duplicate record' });
}

export function corpusSummary(corpus) {
  return `seed=${corpus.seed}; seats=${corpus.counts.seats}; households=${corpus.counts.households}; records=${corpus.counts.records}; ${BIG_FIRM_MARKER}`;
}
