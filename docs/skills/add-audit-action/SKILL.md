---
name: add-audit-action
description: Add a typed, feature-owned audit action descriptor without changing audit-log semantics.
---

# Add an audit action

Use this recipe whenever a feature writes a new durable audit action. The
feature owns its action id and descriptor. The shared registry is only the
append-only public mount list.

## 1. Create the feature-owned descriptor

Place it beside the feature that writes the action. Augment the audit action
map in that same module. There is intentionally no catch-all string entry, so
a misspelled or unregistered id fails TypeScript checking.

```ts
import { Bell } from 'lucide-react';
import type { AuditActionDescriptor } from '@/features/audit/auditActionRegistry';

declare module '@/platform/types/audit' {
  interface AuditActionMap {
    'reminder.sms_sent': true;
  }
}

export const reminderSmsSentAuditAction: AuditActionDescriptor = {
  id: 'reminder.sms_sent',
  labelKey: 'reminders.audit.sms-sent',
  label: 'SMS Reminder Sent',
  icon: Bell,
  category: 'system',
};
```

`labelKey` must resolve in the locale catalog. Keep the compatibility `label`
until the audit screen itself is translated; do not alter the words shown for
existing entries as part of this structural work.

## 2. Add one public registry entry

Append one descriptor to `auditActionRegistry`. Do not reorder existing
entries. Do not put logging, storage, filtering, or feature behavior in the
registry.

## 3. Prove it is safe

Run:

```bash
npm run typecheck
npx vitest run src/features/audit/auditActionRegistry.test.ts tests/unit/audit/audit-action-type-coverage.test.ts
```

Also add a type-only negative probe that assigns a misspelled id to
`AuditActionType` and confirm TypeScript rejects it. Remove that probe before
committing. The audit registry validates duplicate action ids and unresolved
locale keys; its descriptor is the only place to supply id, label, icon, and
category.

## Boundaries

- Do not change what is audited, when it is written, or its stored payload.
- Keep the descriptor public display metadata only.
- Do not add a string index signature to `AuditActionMap`.
- Do not add a second action label, icon, or category map.
