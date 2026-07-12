# Scale findings, July 12, 2026

## What was tested

`npm run test:scale` creates the deterministic **Northstar Ridge** fixture. It
is marked everywhere as fabricated and contains no real client data.

The fixture contains 10 seats, 320 households, 5,912 CRM records, 3,600
activity entries spanning 10 years, 720 tasks, and 420 workflow instances.
It also includes duplicate-looking names, missing fields, Unicode and emoji,
very long notes, restored records, eight-person households, old broken links,
and stale records.

The runner uses the real desktop app through `scripts/crm-loop/launch-app.sh`.
It gives the run its own Vite port, desktop bridge port, virtual screen, and
temporary workspace. It seeds records only with the app's `crm_live_upsert`
command, which writes to the app's encrypted CRM store. It does not create or
edit a database behind the app's back.

## Result

The July 12 run is red before data can be seeded. The fresh app accepts the
desktop bridge connection, but never exposes `spine-nav-matters` after a new
workspace is selected. That means the CRM Home screen is not usable and the
test cannot truthfully measure any of the frozen load ceilings.

`PERF: real-app scale harness: not measurable (ceiling n/a) — Timed out waiting for spine-nav-matters`

## Measured versus ceiling

| Check | Measured | Ceiling | Result |
| --- | ---: | ---: | --- |
| Real app reaches a usable CRM Home | Not measurable | Required before all ceilings | PERF: blocked by fresh-workspace startup |
| Fresh bootstrap transfer | Not measurable | 64 MiB | PERF: CRM Home never mounted |
| Fresh bootstrap to usable Home | Not measurable | 45 s | PERF: CRM Home never mounted |
| Relay restart transfer and recovery | Not measurable | 20 MiB / 60 s | PERF: no mounted CRM relay lifecycle |
| Return after 30 days offline | Not measurable | 32 MiB / 90 s | PERF: no mounted CRM relay lifecycle |
| Ethical-wall/key change | Not measurable | 8 MiB / 30 s | PERF: no mounted CRM wall/key lifecycle |
| Ten-year timeline, full search, Today, report | Not measurable | 10 s each | PERF: CRM Home never mounted |

## Important product gaps the test exposes

1. The new-workspace path must reach the CRM navigation before this is a valid
   release gate. This is a real product blocker, not a test timeout to raise.
2. The running desktop app does not yet expose live CRM relay subscriptions or
   transfer counters. A local database file size is not a download number, so
   the runner deliberately refuses to substitute it. It will remain red for
   relay restart, offline return, and ethical-wall measurements until the app
   mounts that lifecycle and exposes its actual transfer metric.

No product code was changed for this testing lane. The next implementation
step is to fix the fresh-workspace Home path, then add minimal measurement
hooks at the real CRM sync boundary so the runner can measure authenticated
bytes and lifecycle timing without guessing.
