# Fast, real CRM desktop checks

These scripts drive the real desktop app and its encrypted CRM store. They do
not use browser-only storage or pretend that a record was saved.

## Test mode

`launch-app.sh` sets `LANTERN_TEST_MODE=1` unless you explicitly set another
value. The debug desktop window reads it once before the app loads. It hides
only first-run decoration that can cover the screen: the welcome flow and the
automatic feature tour. It does not add data, open a workspace, skip startup,
or bypass persistence. A test that needs the welcome flow can use
`LANTERN_TEST_MODE=0`.

The desktop bridge waits 20 seconds by default because a fresh encrypted CRM
store can take longer than five seconds to open. Set
`LANTERN_DEV_BRIDGE_TIMEOUT_MS` to a value between 100 and 120000 for a
specific slow diagnostic; an individual bridge request can still set its own
`timeout_ms`.

If your build lives outside the worktree's usual target folder, point the
launcher at it with `LANTERN_APP_BINARY=/path/to/lantern`.

## Reusable fixture

Start Vite once, then seed an empty directory:

```bash
npm run dev
scripts/crm-loop/seed-workspace.sh /tmp/crm-fixture
```

The seeder starts a temporary real desktop app and creates two households,
tasks, a pipeline, an opportunity, and a workflow through `crm_set_workspace`
and `crm_live_upsert`. To give a read-only driver a fast start, copy the
fixture first:

```bash
workspace=$(mktemp -d /tmp/crm-check-XXXXXX)
cp -a /tmp/crm-fixture/. "$workspace"/
scripts/crm-loop/launch-app.sh 9263 "$workspace"
```

Keep persistence checks honest: they must create their own record, restart the
app, and verify that record afterwards. The fixture is only for common
read-side setup.
