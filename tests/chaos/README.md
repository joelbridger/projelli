# Real-app crash tests

`npm run test:chaos` opens the actual Linux desktop app through the debug
bridge, gives every scenario a new workspace and port, then kills the process
with `SIGKILL`.  It does not use browser storage, an in-memory database, or a
mocked Tauri command.

The suite is intentionally strict. A record shown as saved must return after a
fresh process launch. A record killed before a save finishes may be absent, but
the encrypted store must still reopen and may not contain a partial record.

Some scenarios are currently expected to report `DATALOSS:` rather than pass:
that is the right outcome until the app wires the promised durable boundary to
the screen. The runner still completes every independent scenario and prints a
short finding for each one.
