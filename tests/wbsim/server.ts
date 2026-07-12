import { createCorpus, type Corpus, type RecordJson } from './corpus/generate';
import { corpusManifest, type CorpusCollection } from './corpus/manifest';
declare const Bun: {
  serve(options: { port: number; fetch(request: Request): Response }): {
    port: number;
    stop(closeActiveConnections?: boolean): void;
  };
};
export interface WealthboxSimulator {
  baseUrl: string;
  corpus: Corpus;
  stop(): void;
}
const routes: Record<string, [CorpusCollection, string]> = {
  '/contacts': ['contacts', 'contacts'],
  '/notes': ['status_updates', 'status_updates'],
  '/tasks': ['tasks', 'tasks'],
  '/events': ['events', 'events'],
  '/opportunities': ['opportunities', 'opportunities'],
  '/projects': ['projects', 'projects'],
  '/workflow_templates': ['workflow_templates', 'workflow_templates'],
  '/workflows': ['workflows', 'workflows'],
  '/workflow_steps': ['workflow_steps', 'workflow_steps'],
  '/categories/custom_fields': ['custom_fields', 'custom_fields'],
  '/categories/tags': ['tags', 'tags'],
  '/categories/opportunity_stage': ['opportunity_stage', 'opportunity_stage'],
  '/contact_roles': ['contact_roles', 'contact_roles'],
  '/users': ['users', 'users'],
  '/teams': ['teams', 'teams'],
  '/customizable_categories': [
    'customizable_categories',
    'customizable_categories',
  ],
};
const absent = new Set([
  '/workflow_instances',
  '/custom_fields',
  '/contact_custom_fields',
  '/custom_field_definitions',
  '/tags',
  '/pipelines',
  '/opportunity_stages',
  '/pipeline_stages',
  '/attachments',
  '/files',
  '/documents',
]);
const no = () => new Response(null, { status: 404 });
const out = (value: unknown, status = 200) => Response.json(value, { status });
function list(records: RecordJson[], key: string, url: URL) {
  if (url.searchParams.get('force_429') === '1')
    return out({ errors: ['Rate limit exceeded'] }, 429);
  const per = Math.min(
    Math.max(Number(url.searchParams.get('per_page')) || 50, 1),
    100
  );
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  if (Number(url.searchParams.get('fail_page')) === page)
    return out({ errors: ['DEMO injected mid-page failure'] }, 503);
  return out({
    meta: {
      total_count: records.length,
      total_pages: records.length ? Math.ceil(records.length / per) : 0,
      page,
    },
    [key]: records.slice((page - 1) * per, page * per),
  });
}
function activity(records: RecordJson[], url: URL) {
  const per = Math.min(
    Math.max(Number(url.searchParams.get('per_page')) || 50, 1),
    100
  );
  const cursor = url.searchParams.get('cursor');
  const page = cursor === null ? 0 : cursor === 'wbsim-cursor-9f9a42' ? 1 : -1;
  if (page < 0) return out({ errors: ['Invalid activity cursor'] }, 422);
  const start = page * per;
  return out({
    meta: {
      page: page + 1,
      cursor: start + per < records.length ? 'wbsim-cursor-9f9a42' : null,
    },
    stream_items: records.slice(start, start + per),
  });
}
/** Bun local-only simulator; it never sends a request to a real vendor. */
export function startSimulator(
  options: { port?: number; corpus?: Corpus } = {}
): WealthboxSimulator {
  const corpus = options.corpus ?? createCorpus();
  const server = Bun.serve({
    port: options.port ?? 0,
    fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/v1(?=\/|$)/, '') || '/';
      if (
        request.method === 'GET' &&
        (absent.has(path) ||
          /^\/contacts\/\d+\/(attachments|files|documents)$/.test(path))
      )
        return no();
      if (request.method === 'GET' && path === '/me')
        return out({
          id: 501,
          name: 'DEMO Northcrest User 1',
          email: 'demo.user1@example.test',
          plan: 'basic',
        });
      if (request.method === 'GET' && /^\/contacts\/\d+$/.test(path)) {
        const row = corpus.contacts.find(
          (r) => r['id'] === Number(path.split('/').pop())
        );
        return row ? out(row) : no();
      }
      if (request.method === 'GET' && path === '/activity')
        return activity(corpus.stream_items, url);
      if (request.method === 'GET' && routes[path]) {
        const [kind, key] = routes[path];
        return list(corpus[kind], key, url);
      }
      if (request.method === 'POST' && path === '/workflows')
        return out(
          {
            errors: [
              'Please include a valid Workflow Template id in your request.',
            ],
          },
          422
        );
      if (request.method === 'POST' && path === '/opportunities')
        return out({ errors: ['Opportunity stage is not valid'] }, 422);
      if (request.method === 'PUT' && /^\/contacts\/\d+$/.test(path))
        return out(
          {
            errors: [
              'One of the custom fields you are attempting to set could not be found, please check the "id" field again for each custom field',
            ],
          },
          422
        );
      return no();
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    corpus,
    stop: () => server.stop(true),
  };
}
if (import.meta.main) {
  const s = startSimulator({ port: Number(process.env['WBSIM_PORT'] ?? 8788) });
  console.log(
    `DEMO Wealthbox simulator at ${s.baseUrl}: ${corpusManifest.label}`
  );
}
