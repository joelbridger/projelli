# Independent CRM acceptance tests

These tests are written from the frozen CRM specification, not from product
implementation. They start the real desktop app through the debug bridge, use a
fresh temporary workspace and bridge port, and speak in advisor-facing terms.

Run:

```bash
npm run test:acceptance
```

The suite is intentionally strict. A missing test handle is a failed acceptance
test: a promised advisor screen must be operable as well as visible. A test that
cannot reach a screen because the app cannot open a fresh workspace is reported
as a product finding, not silently skipped.

Coverage map:

- `client record keeps its complete picture after reopening` — 02 §§1.1–1.5;
  04 §3.
- `a commitment keeps its owner, date, urgency, and repeat rule` — 02 §1.6;
  04 §5.
- `a client can keep a company, trust role, and more than one contact route` — 02 §1.2;
  04 §§3–4.
- `task lists can save an advisor view without changing the shared task truth` — 02 §1.22;
  04 §§5, 12.
- `workflow templates offer a starter library, schedules, and step outcomes` — 02 §§1.7–1.8;
  04 §§6–7.
- `reports show their sources and can become an explicit personal or firm view` — 02 §1.22;
  04 §9.
- `firm setup manages shared labels while keeping member administration separate` — 02 §§1.9,
  1.12–1.13, 1.17; 04 §§12–13.
- `a household exposes its linked email, meetings, and service-tier scheduling safely` —
  04 §§3, 14.
- `firm search and Ask show cited, scoped answers rather than unsupported claims` — 00 D9,
  D22; 04 §§1, 14.
- `the pipeline can be configured and holds opportunities without becoming a project container` —
  02 §§1.14, 1.16; 04 §8.
- `a household timeline and activity feed preserve readable history and local notification state` —
  02 §§1.5, 1.10; 03 §2; 04 §§3, 10.
- `a workflow change is offered one household at a time without erasing progress` —
  03 §4 P1–P10; 04 §§6–7.
- `the migration report accounts for every source type, including attachments` —
  05 §§2.5 and 3; 04 §11.
- `an advisor must approve an outside write` — 00 D5; 04 §§11 and 15.
- `freshness is honest before complete source checks finish` — 00 D26; 04 §15.
