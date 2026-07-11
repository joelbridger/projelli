# Firm relay: v2 only

The firm relay accepts only v2 opaque handles and v2 route-bound ciphertext.
There is no in-app migration from the old relay format. Old relay URLs return
an error, and old ciphertext is not read.

This is safe because no outside firm data has shipped. A development or demo
relay database that contains old data must be reset, then seeded again. Do not
use this procedure for a real customer database.

## Reset a development/demo database

1. Stop the local firm-relay server.
2. Remove its SQLite file. With the standard local setting, run:

   ```bash
   rm -f backend/data/keepance-firm.sqlite
   ```

   If `DB_PATH` points somewhere else, remove that configured development/demo
   file instead.
3. Start the relay again and run the normal local/demo seed or provisioning
   flow. It will create a clean v2 database.

The reset removes test/demo organizations, seats, relay data, and audit history
from that database. This is intentional: it prevents old local client names or
old ciphertext from surviving beside the v2-only relay.

## Why there is no in-app migration

An in-app legacy migration bridge was built and then deliberately removed. It
existed to move existing firm devices from the old readable relay format to the
opaque v2 handles, but no firm data has ever shipped to an outside user, so it
protected nothing. It was also the last place the relay stored a plaintext client
identifier (its manifest table), and it was the largest single source of defects
in this work: every hardening round produced the next round's bugs.

Git history preserves the full implementation. If a real pre-launch migration need
ever appears (it should not — nothing has shipped), the right answer is a one-time
migration run by an operator against a frozen relay, not a live, client-driven,
self-healing protocol carried in the product forever.
