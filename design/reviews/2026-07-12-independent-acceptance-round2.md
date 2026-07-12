# Independent acceptance — round 2

**Date:** 2026-07-12  
**Method:** real desktop app, fresh temporary workspace, test-only changes under
`tests/acceptance/`. The product code was not changed.

## Result

The completed live-app run scored **1 / 15 passing**.

The one passing journey was:

- Reports can run with visible source/freshness details and can be saved as an
  explicitly personal or firm view.

This is not a release-ready result. A green engine or unit-test result does not
replace these user journeys.

## What the app could do

- A person could create a household, save its advisor, service tier, review
  date, and a purpose-labelled masked account.
- The Reports surface exposed a run action, source/freshness details, and an
  explicit saved-view sharing choice.

## Findings

Every item below is either a user-visible product gap or a missing stable
acceptance handle. Per the acceptance contract, a promised screen that cannot
be independently operated is a finding, not a skipped test.

| Priority | Area | Finding | Spec reference |
| --- | --- | --- | --- |
| P0 | Client record | The client record did not expose an operable action for adding a dated, sourced Fact. This blocks the core Client Map truth model. | 02 §1.4; 04 §3 |
| P0 | Tasks | The live task journey did not complete its required assignee, due-date, priority, and recurrence flow. The selector interaction failed before save, so persistence and next-occurrence materialization remain unproven. | 02 §1.6; 04 §5; 01 §4 |
| P0 | Workflows | The template creation journey did not expose the promised operable template control; starter library, scheduling, outcomes/branching, publish, propagation review, and safe undo are therefore not accepted. | 02 §§1.7–1.8; 03 §4; 04 §§6–7 |
| P0 | Firm and migration | Home did not expose an operable Firm route. This blocks firm setup, custom fields/tags, migration fidelity, both mandatory fallback routes, archive/rollback readiness, and approval-gated parallel writes. | 04 §§11–13; 05 §§2.5, 3; 00 D5, D23–D26 |
| P0 | Ask/search | Ask did not expose the promised CRM question input. A cited, scoped firm answer could not be driven, so this is not accepted. | 00 D9, D22; 04 §§1, 14 |
| P1 | Contacts | The person/trust flow lacked an operable way to add and verify more than one contact channel. Company, trust/organization, external role, and multiple-channel support are not accepted. | 02 §1.2; 04 §§3–4; 01 §1 |
| P1 | Saved task views | The Tasks surface did not expose the promised save-view action. | 02 §1.22; 04 §§5, 12 |
| P1 | Email, meetings, calendar | The household flow did not expose the linked Email and Meetings surfaces or a usable service-tier scheduling link. | 02 §1.9; 04 §§3, 14 |
| P1 | Pipeline | The opportunity flow could not reach an operable opportunity editor after pipeline setup. Pipeline/stage configuration and Legacy Project safeguards remain unaccepted. | 02 §§1.14, 1.16; 04 §8 |
| P1 | Timeline and notifications | The household Timeline and recipient notification inbox could not be operated in the live run. Local read state and the required relay-metadata disclosure remain unaccepted. | 02 §1.10; 03 §2; 04 §§3, 10 |

## Test-environment note

The worktree initially had no installed JavaScript packages, so the preview
server could not start because its PDF worker file was absent. `npm ci` restored
the test environment; this was not counted as a product finding.

An old preview process from a finished, separate job also briefly occupied the
standard local preview address. It was removed before the completed result
above. A later rerun encountered a stale debug bridge before the app could open
its fresh workspace; that run was correctly recorded as blocked and is not used
for the 1/15 score.

## Test coverage added

The acceptance suite now includes user journeys for:

- client facts, accounts, audience lanes, and persistence;
- tasks, recurrence, priority, assignee, and saved views;
- people, trusts, companies, external roles, and contact channels;
- workflow library, schedules, outcomes, propagation, and undo;
- reports and saved views;
- firm setup, custom fields, and tags;
- email, meetings, calendar scheduling, Ask/search with citations;
- pipeline, timeline, activity, notifications;
- migration fidelity, workflow re-creation, attachment accounting, and
  external-write approval.

## Recommended repair order

1. Make Home routes for Tasks, Workflows, Pipeline, Reports, and Firm reliably
   reachable in the real app, then make the Firm route work.
2. Wire the daily CRM records: Facts, tasks, contacts/channels, timeline, and
   notifications.
3. Wire template creation through scheduling/outcomes, propagation, and undo.
4. Finish the migration and external-approval surfaces only after the firm
   route is real.
5. Re-run this exact acceptance suite on a fresh workspace. Do not mark a
   surface done based only on engine tests or a visible shell.
