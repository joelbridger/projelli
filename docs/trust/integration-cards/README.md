# Integration Honesty Cards

Integration claims get vague fast. These cards keep them exact.

Every shipping connector gets one public card. The card says what Advisor Prep Hero reads, what it writes, what it can never touch, how writes are gated, and when the code was last checked.

## Shipping cards

- [Wealthbox](./WEALTHBOX.md)
- [Email: Microsoft 365, Gmail, and IMAP](./EMAIL.md)
- [OneDrive and SharePoint](./ONEDRIVE-SHAREPOINT.md)
- [Calendly](./CALENDLY.md)

Use [TEMPLATE.md](./TEMPLATE.md) for every new connector.

## How cards stay honest

These cards are code-derived. Do not update them from a sales page, a roadmap, or a memory of how the connector is supposed to work.

When connector code changes, update the card in the same change if any of these changed:

- A new API endpoint.
- A new OAuth scope or permission.
- A new object type read from the outside service.
- A new field read from the outside service.
- A new remote write.
- A new local write, local store, local import, or local deletion.
- A new review, approval, receipt, or audit path.
- A new "never touch" guarantee that the code now enforces.
- A removed guarantee.

Before release, re-verify the card against the connector code:

1. Read the connector feature folder under `src/features/`.
2. Read the connector commands under `src-tauri/src/commands/`.
3. Search for that connector's remote clients, write calls, send calls, delete calls, sync store, and audit paths.
4. Update the exact read, write, never-touch, gating, and limits sections.
5. Update `Last verified`.
6. Update the evidence comment at the bottom of the card.

## Review rule

If the code and the card disagree, the card is wrong. Fix the card before the connector is described publicly.

If the card says "read-only", the code must not contain a remote POST, PUT, PATCH, DELETE, upload, send, or update path for that connector.

If the card says "advisor-approved", the code must show the review screen, the approval action, and the receipt or audit entry.

## Words not allowed

Do not use vague integration words on these cards:

- "Deep integration"
- "Full sync"
- "Two-way sync"
- "Works with everything"
- "Connects your whole stack"

Say the object names, field names, write actions, and limits instead.
