| Workflows | `GET /workflows?page=1&per_page=1` → **200**: `{"meta":…,"workflows":[]}` | **READABLE**, but this sandbox has no workflows. |
| Workflow steps | `GET /workflow_steps?page=1&per_page=1` → **200**: `{"meta":…,"workflow_steps":[]}` | **READABLE**, not proven write-only. No step data exists here. |
| Workflow templates | `GET /workflow_templates?page=1&per_page=1` → **200**: `{"meta":…,"workflow_templates":[]}` | **READABLE**, empty. |
| Workflow instances | `GET /workflow_instances…` → **404**, empty body | **ABSENT** at this address. |
| Current workflow step/stage | No workflow, template, or step records exist to inspect. | **UNVERIFIED.** The API allows reading the collections, but this account cannot prove whether populated workflows expose current state. |
| Custom-field registry | `GET /custom_fields`, `/contact_custom_fields`, and `/custom_field_definitions` → **404**, empty body | **ABSENT** on these likely registry addresses. |
| Custom-field values on contacts | `GET /contacts…` → **200**; each contact has `custom_fields`. First 100 contacts had `custom_fields: []`. | **READABLE SHAPE; no live values to inspect.** |
| Tags registry | `GET /categories/tags?page=1&per_page=50` → **200**: `{"meta":{"total_count":2,"total_pages":1,"page":1},"tags":[{"id":…,"name":"…","type":"…","document_type":"…"},…]}` | **READABLE.** The correct registry path is `/categories/tags`, not `/tags`. |
| Tags on contacts | First 100 returned contacts each had tag objects with `id` and `name`. | **READABLE.** |
| Opportunities | `GET /opportunities…` → **200**: `{"meta":…,"opportunities":[]}` | **READABLE**, empty. |
| Pipelines | `GET /pipelines…` → **404**, empty body | **ABSENT** at this address. |
| Opportunity stages | `GET /opportunity_stages…` and `/pipeline_stages…` → **404`; `GET /categories/opportunity_stage…` → **200**, empty collection | Stage categories appear **READABLE** through `/categories/opportunity_stage`, but no actual stages/opportunities exist to inspect. |
| Projects | `GET /projects…` → **200**: `{"meta":…,"projects":[]}` | **READABLE**, empty. |
| Files / attachments | Global and contact paths for `/attachments`, `/files`, `/documents`, plus `/contacts/{id}/attachments`, `/files`, and `/documents` all returned **404**, empty body. | **ABSENT** on every tested read path. No list or download endpoint found. |
| Activity stream | `GET /activity?page=1&per_page=50` → **200**: `{"meta":{"page":1,"cursor":"[redacted]"},"stream_items":[{"id":…,"body":"…","header":"…","creator":…,"linked_to":…,"created_at":…},…]}` | **READABLE.** |
| Activity next page | `GET /activity?cursor=[redacted]&per_page=50` → **200**, 50 more items and another cursor | **READABLE with cursor pagination.** |
| Users | `GET /users?page=1&per_page=50` → **200**: one user, fields `id,name,email,status,account,excluded_from_assignments` | **READABLE.** |
| Teams | `GET /teams?page=1&per_page=50` → **200**: `{"meta":{"total_count":0,…},"teams":[]}` | **READABLE**, empty. |

## Pagination and rate limits

- Normal list endpoints return `meta.total_count`, `meta.total_pages`, and `meta.page`.
- A contacts request with `per_page=1` returned one of 229 contacts and 229 pages.
- A request for `per_page=250` returned **100** contacts and reported three pages. Treat **100 as the effective page cap**.
- Activity is different: it returns an opaque `meta.cursor`, and passing that cursor successfully retrieved the next page.
- Across 36 paced GET requests, no `429`, `Retry-After`, `X-RateLimit-*`, or `Link` pagination headers appeared. This does not prove there is no rate limit, only that none was reached or advertised.

## Recommended design changes

```diff
- Tags: use a dedicated /tags list endpoint.
+ Tags: import the registry from GET /categories/tags.
+ Contact tag values are also readable directly on contact records as { id, name }.

- Use 50 records per page; the API maximum is unverified.
+ Use 100 records per page. A request for 250 was capped to 100 by the live API.

- Activity cursor compatibility is unverified.
+ Activity uses an opaque cursor. A single stored cursor string is sufficient:
+ GET /activity?cursor=<opaque-cursor>&per_page=100 returns the next page.

- Workflow steps may be write-only.
+ Do not call workflow steps write-only. GET /workflow_steps returns 200.
+ Keep current-step/state fidelity marked UNVERIFIED until a sandbox with an
+ open workflow can be read. /workflow_instances itself returned 404.

- Files/attachments have no documented source endpoint.
+ Keep files/attachments explicitly out of v1 migration scope. The tested global
+ and per-contact attachment/file/document read paths all returned 404.

- Custom fields are imported from a registry endpoint.
+ Treat registry import as unavailable for now: /custom_fields and likely variants
+ returned 404. Contact records expose custom_fields arrays, but the first 100
+ contacts had no populated examples, so value shape remains unverified.
```

Basic-plan caveat: workflows, opportunities, projects, teams, custom fields, and pipeline stages may be empty because this sandbox has not enabled or populated them, possibly including tier differences. Nothing returned a plan-gate status such as 402 or 403, so plan gating was not proven.

