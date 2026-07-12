# Independent acceptance findings — 2026-07-12

## Result

`npm run test:acceptance` is **red: 0/6 passed**. It launched the real Linux
desktop app through `scripts/crm-loop/launch-app.sh`, on a unique bridge port
and a new temporary workspace. This was not a browser mock or a unit test.

The app reached its workspace chooser. The standard desktop-test bootstrap then
registered a fresh workspace and used the app's normal automatic-resume path.
It remained on the sole screen `workspace-auto-resume-loading` for more than
20 seconds. Home, Clients, and Ask never appeared. The runner therefore marks
every required advisor journey as **BLOCKED**, rather than pretending an
unvisited screen passed.

## Findings

### ACC-001 — P0: a fresh firm cannot reach the CRM

**Observed:** A new isolated workspace opens into an endless loading screen,
not the three-tab CRM navigation. The desktop bridge remained healthy; only the
product UI failed to advance.

**Why this breaks the contract:** 04 §1 says Home is the launch landing surface
and provides Home, Clients, and Ask as the top-level navigation. The six core
acceptance journeys cannot begin until that screen is reachable.

**Affected advisor journeys:** client records, tasks, workflow propagation,
migration/fidelity, approval-gated parallel-run writes, and freshness states.

**Evidence:** `npm run test:acceptance` printed all six journeys as BLOCKED with
the same `workspace-auto-resume-loading` condition. The run used bridge port
`33419` and a newly created temporary workspace; it did not reuse another
agent's data or already-open desktop window.

**Classification:** product bug. This is a release-blocking first-use failure,
not a test failure.

### ACC-002 — P1: two required Client Map actions have no stable driving handle

**Observed:** The household screen exposes a stable panel handle for Facts and
a stable handle for adding a client-facing note. It does not expose a stable
`data-testid` handle for either **Add Fact** or **Add internal note**.

**Why this breaks the contract:** 04 §3 names both as direct local edits, and
02 §§1.4–1.5 requires Facts to retain dates/sources/history and Notes to keep
an immutable internal/client-facing wall. An independent real-app test cannot
create and reopen those records without guessing at presentational markup.

**Test behavior:** once ACC-001 is fixed, the client-record journey will fail
at these missing controls instead of silently omitting the Fact and internal
note portions of the record.

**Classification:** product testability/operability bug. A promised advisor
action needs a stable, accessible control for reliable desktop driving.

### ACC-003 — P1: freshness has no specified black-box way to prove the
"not yet complete" condition

**Observed:** 04 §15 correctly defines Live as *every contributing subscription
has reached its watermark*, and requires Syncing/Last synced/Offline otherwise.
The product contract does not expose a user-operable, deterministic way for an
acceptance run to place a connector in the incomplete-subscription state.

**Why it matters:** without such a seam, a green badge can be visually checked
but cannot be adversarially proven never to say Live too early. The independent
test asserts the initial migration freshness banner is not bare Live, but the
stronger required condition remains blocked behind ACC-001 and lacks a stated
black-box setup path.

**Classification:** specification/testability ambiguity. The freshness meaning
is clear; the acceptance setup needed to demonstrate its negative case is not.

## Included tests, ready after the first-use blocker is fixed

1. **Client record keeps its complete picture after reopening** — household,
   advisor, service tier, review due date, masked account and purpose, plus the
   required Fact and two immutable note lanes.
2. **A commitment keeps its owner, date, urgency, and repeat rule** — a single
   assignee, due date, high priority and annual recurrence survive reopening;
   completing it must materialize the next child.
3. **A workflow change is offered one household at a time without erasing
   progress** — per-step accept/reject, protected completed work, and
   conditional undo with protected-cell reporting.
4. **The migration report accounts for every source type, including
   attachments** — every canonical fidelity-matrix row, explicit 0%-via-API
   attachment language, exported-or-gap accounting, and both fallback routes.
5. **An advisor must approve an outside write** — parallel-run write remains in
   the approval queue and is not sent before approval.
6. **Freshness is honest before complete source checks finish** — no bare Live
   claim while the screen has no demonstrated complete source check.

The tests deliberately remain red on real failures. No product code was changed.
