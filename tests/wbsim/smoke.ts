import { corpusManifest, type CorpusCollection } from './corpus/manifest';
import { startSimulator } from './server';
const routes: Record<CorpusCollection, [string, string]> = {
  contacts: ['/contacts', 'contacts'],
  status_updates: ['/notes', 'status_updates'],
  tasks: ['/tasks', 'tasks'],
  events: ['/events', 'events'],
  opportunities: ['/opportunities', 'opportunities'],
  projects: ['/projects', 'projects'],
  workflow_templates: ['/workflow_templates', 'workflow_templates'],
  workflows: ['/workflows', 'workflows'],
  workflow_steps: ['/workflow_steps', 'workflow_steps'],
  custom_fields: [
    '/categories/custom_fields?document_type=Contact',
    'custom_fields',
  ],
  tags: ['/categories/tags', 'tags'],
  opportunity_stage: ['/categories/opportunity_stage', 'opportunity_stage'],
  contact_roles: ['/contact_roles', 'contact_roles'],
  users: ['/users', 'users'],
  teams: ['/teams', 'teams'],
  customizable_categories: [
    '/customizable_categories',
    'customizable_categories',
  ],
  stream_items: ['/activity', 'stream_items'],
};
const ok: (x: unknown, m: string) => asserts x = (x, m) => {
  if (!x) throw Error(m);
};
const get = async (url: string) => {
  const response = await fetch(url);
  return [response, await response.json().catch(() => null)] as const;
};
async function paged(
  base: string,
  path: string,
  key: string,
  expected: number
) {
  const rows: Record<string, unknown>[] = [];
  for (
    let page = 1;
    rows.length < expected || (expected === 0 && page === 1);
    page++
  ) {
    const [res, body] = await get(
      `${base}${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=250`
    );
    ok(res.status === 200 && body, `${path} failed`);
    const data = body as Record<string, unknown>,
      items = data[key] as Record<string, unknown>[];
    ok(
      Array.isArray(items) &&
        items.length <= 100 &&
        (data['meta'] as Record<string, unknown>)['total_count'] === expected,
      `${path} bad shape`
    );
    rows.push(...items);
    if (!items.length || rows.length >= expected) break;
  }
  ok(rows.length === expected, `${path} count mismatch`);
  return rows;
}
async function stream(base: string, expected: number) {
  const rows: Record<string, unknown>[] = [];
  let cursor = '';
  do {
    const [res, body] = await get(
      `${base}/activity?per_page=250${cursor ? `&cursor=${cursor}` : ''}`
    );
    ok(
      res.status === 200 && !res.headers.has('Link') && body,
      'activity shape'
    );
    const data = body as Record<string, unknown>,
      items = data['stream_items'] as Record<string, unknown>[];
    ok(Array.isArray(items) && items.length <= 100, 'activity cap');
    rows.push(...items);
    cursor =
      ((data['meta'] as Record<string, unknown>)['cursor'] as string | null) ?? '';
  } while (cursor);
  ok(rows.length === expected, 'activity count');
  return rows;
}
const s = startSimulator();
try {
  const all: Partial<Record<CorpusCollection, Record<string, unknown>[]>> = {};
  for (const [kind, expected] of Object.entries(
    corpusManifest.fidelityCounts
  ) as [CorpusCollection, number][])
    all[kind] =
      kind === 'stream_items'
        ? await stream(s.baseUrl, expected)
        : await paged(s.baseUrl, ...routes[kind], expected);
  ok(
    ['household', 'person', 'organization', 'trust'].every((type) =>
      all.contacts?.some((r) => r['type'] === type)
    ),
    'contact types'
  );
  ok(
    all.status_updates?.some((r) => (r['linked_to'] as unknown[]).length > 1),
    'multi-link note'
  );
  ok(
    all.tasks?.some((r) => r['wbsim_case'] === 'UNVERIFIED nested-subtask shape'),
    'subtask fixture'
  );
  ok(
    all.opportunities?.every(
      (r) => typeof r['stage'] === 'number' && r['stage_label_missing'] === true
    ) && all.opportunity_stage?.length === 0,
    'raw stage fixture'
  );
  const [me] = await get(`${s.baseUrl}/me`);
  ok(me.status === 200, 'Basic plan state');
  for (const path of [
    '/workflow_instances',
    '/attachments',
    '/files',
    '/documents',
    '/contacts/10001/attachments',
    '/custom_fields',
    '/pipelines',
  ])
    ok(
      (await fetch(`${s.baseUrl}${path}`)).status === 404,
      `${path} should 404`
    );
  for (const [path, method, phrase] of [
    ['/workflows', 'POST', 'valid Workflow Template'],
    ['/opportunities', 'POST', 'Opportunity stage'],
    ['/contacts/10001', 'PUT', 'custom fields'],
  ] as const) {
    const r = await fetch(`${s.baseUrl}${path}`, { method });
    ok(
      r.status === 422 && (await r.text()).includes(phrase),
      `${path} validation`
    );
  }
  ok(
    (await fetch(`${s.baseUrl}/contacts?force_429=1`)).status === 429 &&
      (await fetch(`${s.baseUrl}/contacts?page=2&fail_page=2`)).status === 503,
    'fault injection'
  );
  console.log(
    `wbsim smoke passed: 17 endpoint shapes, fixed seed ${corpusManifest.seed}`
  );
} finally {
  s.stop();
}
