# [Connector Name] Integration Honesty Card

Last verified: YYYY-MM-DD

Status: Shipping

This card says exactly what this connector can read, what it can write, and what it cannot touch.

## What this connector reads

From [service name]:

- `[object name]`: `[field]`, `[field]`, `[field]`
- `[object name]`: `[field]`, `[field]`, `[field]`

On this device:

- `[local object or store]`: `[field]`, `[field]`, `[field]`

## What this connector writes

In [service name]:

- `[write action]`: `[exact object]` with `[exact fields]`
- If this connector is read-only, write `Nothing. The connector has no remote write path.`

On this device:

- `[local store or file]`: `[exact data written]`
- `[local index]`: `[exact data indexed]`

## What this connector can never touch

- `[object, area, or action that the code does not expose]`
- `[object, area, or action that is blocked by design]`
- `[destructive action, if no code path exists]`

## How writes are gated

- Review card: `[where the user reviews the proposed write]`
- Approval action: `[the exact button or action that sends it]`
- Receipt: `[what is stored after success, such as a remote id, draft id, sent status, or audit entry]`
- Background behavior: `[state whether background sync can or cannot write remotely]`

If the connector is read-only:

- Remote writes: Not available.
- Local imports: Run only after the user connects the account and starts sync.
- Receipts: The sync report records what was imported, indexed, skipped, removed locally, or stopped.

## Limits worth knowing

- `[plain-language limit]`
- `[plain-language limit]`

<!--
Evidence:
- src/features/[connector]/
- src-tauri/src/commands/[connector]/
-->
