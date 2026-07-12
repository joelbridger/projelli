import { corpusManifest, type CorpusCollection } from './manifest';
export type RecordJson = Record<string, unknown>;
export type Corpus = Record<CorpusCollection, RecordJson[]>;
const stamp = (i: number) =>
  `2026-07-${String((i % 28) + 1).padStart(2, '0')} 09:30 AM -0400`;
const linked = (id: number, type: string, name: string) => ({ id, type, name });
const customFields = (i: number) =>
  i % 10 === 0
    ? [
        {
          name: 'DEMO Risk Band',
          id: 91001,
          field_type: 'text_field',
          document_type: 'Contact',
          metadata: {},
          value: 'DEMO Medium',
        },
        {
          name: 'DEMO Household Score',
          id: 91002,
          field_type: 'number',
          document_type: 'Contact',
          metadata: { precision: 0 },
          value: 72,
        },
        {
          name: 'DEMO Archived Flag',
          id: 91003,
          field_type: 'checkbox',
          document_type: 'Contact',
          metadata: {},
          value: null,
        },
      ]
    : i % 7 === 0
      ? [
          {
            name: 'DEMO Risk Band',
            id: 91001,
            field_type: 'text_field',
            document_type: 'Contact',
            metadata: {},
            value: null,
          },
        ]
      : [];

/** No Date/Math.random: a repeat call produces byte-for-byte equivalent fixtures. */
export function createCorpus(): Corpus {
  const contacts: RecordJson[] = [];
  const homes: { id: number; name: string; members: RecordJson[] }[] = [];
  for (let i = 1; i <= 40; i++) {
    const id = 10000 + i;
    const name = `DEMO Northcrest Household ${String(i).padStart(2, '0')}`;
    homes.push({ id, name, members: [] });
    contacts.push({
      id,
      type: 'household',
      name,
      creator: 501,
      created_at: stamp(i),
      updated_at: stamp(i + 1),
      assigned_to: i % 9 ? 501 + (i % 4) : null,
      email_addresses: i % 6 ? [] : null,
      phone_numbers: [],
      street_addresses: [],
      tags: i % 5 ? [] : [{ id: 81001, name: 'DEMO Client' }],
      custom_fields: customFields(i),
      financial_profile: i % 8 ? { assets: '$1,200,000' } : null,
    });
  }
  for (let i = 1; i <= 76; i++) {
    const h = homes[(i - 1) % 40]!;
    const id = 10100 + i;
    const first = `DEMO Person ${String(i).padStart(2, '0')}`;
    const member = {
      id,
      first_name: first,
      last_name: 'Northcrest',
      title: i % 3 ? 'Head' : 'Spouse',
      type: 'person',
    };
    h.members.push(member);
    contacts.push({
      id,
      type: 'person',
      name: `${first} Northcrest`,
      first_name: first,
      last_name: 'Northcrest',
      creator: 501,
      created_at: stamp(i),
      updated_at: stamp(i),
      assigned_to: i % 11 ? 502 : null,
      email_addresses: [
        {
          address: `demo.person${i}@example.test`,
          kind: 'Personal',
          principal: true,
        },
      ],
      phone_numbers: [],
      tags: [],
      household: {
        id: h.id,
        name: h.name,
        title: member.title,
        members: h.members,
      },
      custom_fields: customFields(i + 40),
    });
  }
  for (let i = 1; i <= 4; i++)
    contacts.push({
      id: 10200 + i,
      type: 'organization',
      name: `DEMO Northcrest Organization ${i}`,
      created_at: stamp(i),
      updated_at: stamp(i),
      email_addresses: [],
      tags: [],
      custom_fields: [],
    });
  for (let i = 1; i <= 4; i++)
    contacts.push({
      id: 10210 + i,
      type: 'trust',
      name: `DEMO Northcrest Trust ${i}`,
      created_at: stamp(i),
      updated_at: stamp(i),
      email_addresses: [],
      tags: [],
      custom_fields: [],
    });
  const contact = (i: number) =>
    contacts[(i - 1) % contacts.length] as { id: number; name: string };
  const status_updates = Array.from({ length: 62 }, (_, n) => {
    const i = n + 1,
      a = contact(i),
      b = contact(i + 17);
    return {
      id: 20000 + i,
      body: `DEMO Northcrest note ${i}`,
      creator: 501,
      created_at: stamp(i),
      updated_at: stamp(i),
      linked_to:
        i % 6
          ? [linked(a.id, 'Contact', a.name)]
          : [linked(a.id, 'Contact', a.name), linked(b.id, 'Contact', b.name)],
      custom_fields: i % 9 ? [] : null,
    };
  });
  // Same number as Contact 10001: type, not number, is the confidentiality boundary.
  status_updates.push({
    id: 20064,
    body: 'DEMO collision guard note',
    creator: 501,
    created_at: stamp(1),
    updated_at: stamp(1),
    linked_to: [linked(10001, 'Project', 'DEMO Project collision')],
    custom_fields: null,
  });
  const tasks = Array.from({ length: 58 }, (_, n) => {
    const i = n + 1,
      c = contact(i);
    return {
      id: 30000 + i,
      name: `DEMO task ${i}`,
      description: i % 5 ? `DEMO task detail ${i}` : null,
      status: i % 3 ? 'Open' : 'Completed',
      due_date:
        i % 7 ? `2026-08-${String((i % 28) + 1).padStart(2, '0')}` : null,
      assigned_to: i % 8 ? 501 : null,
      linked_to: [linked(c.id, 'Contact', c.name)],
      recurrence: i % 9 ? null : { frequency: 'monthly', interval: 1 },
      subtasks:
        i === 1
          ? [
              {
                id: 300011,
                name: 'DEMO nested task — UNVERIFIED',
                completed: false,
              },
            ]
          : [],
      ...(i === 1 ? { wbsim_case: 'UNVERIFIED nested-subtask shape' } : {}),
    };
  });
  const events = Array.from({ length: 37 }, (_, n) => {
    const i = n + 1,
      c = contact(i);
    return {
      id: 40000 + i,
      name: `DEMO meeting ${i}`,
      description: i % 6 ? `DEMO event ${i}` : null,
      starts_at: stamp(i),
      ends_at: stamp(i),
      creator: 501,
      linked_to: [linked(c.id, 'Contact', c.name)],
    };
  });
  const opportunities = Array.from({ length: 25 }, (_, n) => {
    const i = n + 1,
      c = contact(i);
    return {
      id: 50000 + i,
      name: `DEMO opportunity ${i}`,
      description: '',
      probability: 50,
      target_close: stamp(i),
      manager: 501,
      stage: 1169841,
      amounts: [
        {
          id: 51000 + i,
          amount: `$${(i * 1000).toLocaleString('en-US')}`,
          basis_points: null,
          kind: 'Fee',
        },
      ],
      custom_fields: [],
      linked_to: [linked(c.id, 'Contact', c.name)],
      stage_label_missing: true,
      wbsim_case: 'preserve raw stage id; category lookup deliberately empty',
    };
  });
  // Binding probe behavior: a supplied project linked_to does not persist or return.
  const projects = Array.from({ length: 16 }, (_, n) => {
    const i = n + 1;
    return {
      id: i === 1 ? 10001 : 60000 + i,
      creator: 501,
      created_at: stamp(i),
      updated_at: stamp(i),
      name: `DEMO Northcrest project ${i}`,
      description: `DEMO fabricated project ${i}`,
      organizer: i % 2 ? null : 502,
      visible_to: 'Everyone',
      image: null,
      custom_fields: [],
    };
  });
  const users = [501, 502, 503, 504].map((id, i) => ({
    id,
    name: `DEMO Northcrest User ${i + 1}`,
    email: `demo.user${i + 1}@example.test`,
    status: 'active',
    account: 'DEMO Northcrest',
    excluded_from_assignments: false,
  }));
  const teams = [
    { id: 71001, name: 'DEMO Advisory Team', members: [501, 502] },
    { id: 71002, name: 'DEMO Service Team', members: [503, 504] },
  ];
  const custom_fields = [
    {
      name: 'DEMO Risk Band',
      id: 91001,
      document_type: 'Contact',
      field_type: 'text_field',
      metadata: {},
      options: [],
    },
    {
      name: 'DEMO Household Score',
      id: 91002,
      document_type: 'Contact',
      field_type: 'number',
      metadata: { precision: 0 },
      options: [],
    },
    {
      name: 'DEMO Archived Flag',
      id: 91003,
      document_type: 'Contact',
      field_type: 'checkbox',
      metadata: {},
      options: [],
    },
  ];
  const tags = [
    'DEMO Client',
    'DEMO Review Due',
    'DEMO Prospect',
    'DEMO Trust',
    'DEMO Archive',
  ].map((name, i) => ({
    id: 81001 + i,
    name,
    type: 'tag',
    document_type: 'Contact',
  }));
  const contact_roles = ['Attorney', 'CPA', 'Trustee', 'Beneficiary'].map(
    (name, i) => ({ id: 82001 + i, name: `DEMO ${name}`, type: 'Contact' })
  );
  const customizable_categories = [
    'source',
    'status',
    'priority',
    'relationship',
  ].map((type, i) => ({
    id: 83001 + i,
    name: `DEMO ${type}`,
    type,
    document_type: 'Contact',
  }));
  const stream_items = Array.from({ length: 113 }, (_, n) => {
    const i = n + 1,
      c = contact(i);
    return {
      id: 90000 + i,
      header: i % 4 ? 'DEMO user signed in' : 'DEMO contact updated',
      body: `DEMO activity ${i}`,
      creator: { id: 501, name: 'DEMO Northcrest User 1' },
      linked_to: i % 4 ? [] : [linked(c.id, 'Contact', c.name)],
      created_at: stamp(i),
    };
  });
  const corpus = {
    contacts,
    status_updates,
    tasks,
    events,
    opportunities,
    projects,
    workflow_templates: [],
    workflows: [],
    workflow_steps: [],
    custom_fields,
    tags,
    opportunity_stage: [],
    contact_roles,
    users,
    teams,
    customizable_categories,
    stream_items,
  } satisfies Corpus;
  for (const [key, count] of Object.entries(corpusManifest.fidelityCounts))
    if (corpus[key as CorpusCollection].length !== count)
      throw new Error(`Manifest mismatch: ${key}`);
  return corpus;
}
