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
- `a workflow change is offered one household at a time without erasing progress` —
  03 §4 P1–P10; 04 §§6–7.
- `the migration report accounts for every source type, including attachments` —
  05 §§2.5 and 3; 04 §11.
- `an advisor must approve an outside write` — 00 D5; 04 §§11 and 15.
- `freshness is honest before complete source checks finish` — 00 D26; 04 §15.
