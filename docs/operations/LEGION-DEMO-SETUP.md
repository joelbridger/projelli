# Legion Demo Setup

**Current as of 2026-07-09.** This captures the current demo data, reset rules, and mail facts for the Legion bench.

## Demo data

The current advisor demo uses 80 Wealthbox "Northcrest" demo households.

The workspace on the Legion is:

```text
C:\Users\james\Documents\Beacon Ridge Demo
```

The workspace data folder is inside it:

```text
C:\Users\james\Documents\Beacon Ridge Demo\.lantern
```

That `.lantern` folder holds the private workspace data, including:

- `mail-enc.db`
- `crm-enc.db`
- `audit-enc.db`
- the RAG store
- `mail/blobs`

Treat `.lantern` as part of the demo workspace. Deleting it wipes the local index and imported workspace data for that demo.

## App state lives outside the workspace too

The desktop app also stores first-run state and app settings in Windows app-data folders.

To truly reset onboarding, clear both Roaming and Local app-data for both old and new app names:

Roaming:

- `lantern`
- `keepance`

Local:

- `com.lantern.app`
- `com.keepance.app`
- `Keepance`

Plain rule: deleting only the workspace is not a full reset. The app may still remember onboarding, accounts, or settings from AppData.

## Sarah Morgan demo account

The demo Microsoft 365 account is:

```text
sarah.morgan.cfp@outlook.com
```

Credentials are stored on the server under:

```text
~/lantern-coordination/demo-creds/
```

Do not copy secrets into docs, commits, chat, logs, screenshots, or issue text.

## Seeded demo email

50 realistic client emails were seeded to Sarah Morgan's inbox through Brevo.

Relevant scripts:

```text
~/lantern-plus/scripts/demo/brevo_send.py
~/lantern-plus/scripts/demo/inbox_emails.py
```

Those scripts are the reference for what was sent. Do not paste credentials or provider keys from the environment into docs.

## Mail filing behavior

Imported mail starts as `UNASSIGNED`.

Mail becomes tied to a client only when one of these happens:

1. An account or folder is mapped in Client settings under "Email accounts in this client".
2. A message is manually filed with "File to matter".

There is no automatic sender-to-client matching yet.

So if Ask cannot find an email for a client, first check whether the mail was actually assigned to that client. Do not assume the importer matched it by sender.

## Known email recall bug

Known bug, fix in flight on `lane/mail-rag-heal`:

- A degraded-purge RAG rebuild can drop email chunks.
- The backfill marker is not set.
- Ask then loses email recall until `mail_backfill_rag` runs again.

Plain version: the email may be in the mail database, but the question-answering index may have lost its copy. Re-run the mail RAG backfill before concluding that import failed.

## Reset checklist

Use this when the demo needs to feel fresh:

1. Stop the app with `Stop-ScheduledTask -TaskName KeepanceDev`.
2. Decide whether to wipe only the workspace index or the whole app state.
3. For workspace-only reset, remove `.lantern` inside `C:\Users\james\Documents\Beacon Ridge Demo`.
4. For true onboarding reset, also clear the Roaming and Local folders listed above.
5. Start the app with `Start-ScheduledTask -TaskName KeepanceDev`.
6. Confirm the bridge with `http://127.0.0.1:9250/health`.

Do not ask Jameson to do this bench reset. The AI should do it over the Legion bench.
