---
name: add-account-section-connection
description: Add a typed Account-window tab or connection card without bypassing the Account registries.
---

# Add an Account section or connection card

Use this recipe when adding something to the Account window. The Account
registries are the only mount lists. A section or connector owns its own
descriptor and its own stable ID; the registry only chooses where it appears.

## The ID safety rule

Before writing a descriptor, augment the matching closed ID map in the module
that owns it. The maps deliberately have no catch-all string entry, so a typo
does not type-check ([`account.ts:1-18`](../../../src/platform/types/account.ts#L1-L18)).
The descriptor types consume those IDs at
[`accountRegistryTypes.ts:8-41`](../../../src/features/account/accountRegistryTypes.ts#L8-L41).

For a new section:

```tsx
import type { AccountSectionDescriptor } from '@/features/account/accountRegistryTypes';

declare module '@/platform/types/account' {
  interface AccountSectionIdMap {
    billing: true;
  }
}

export const billingAccountSection: AccountSectionDescriptor = {
  id: 'billing',
  labelKey: 'account.sections.billing',
  legacyLabel: 'Billing',
  placement: 'tab',
  order: 50,
  render: () => <BillingSection />,
};
```

For a connector card:

```tsx
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';

declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    custodian: true;
  }
}

export const custodianConnectionCard: ConnectionCardDescriptor = {
  id: 'custodian',
  labelKey: 'connectors.custodian',
  placement: 'connections',
  order: 170,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
```

Keep the declaration beside the descriptor. Existing connector cards follow
this pattern, for example [`addepar/accountConnectionCard.tsx:1-13`](../../../src/platform/connectors/addepar/accountConnectionCard.tsx#L1-L13).

## Add an Account section

1. Put the section component and descriptor in the feature that owns it.
2. Augment `AccountSectionIdMap` with exactly its ID, then use that ID in the
   descriptor.
3. Add the descriptor once to `accountSectionRegistry`. It is the append-only
   Account tab mount list ([`accountSectionRegistry.ts:1-6`](../../../src/features/account/accountSectionRegistry.ts#L1-L6)).
4. Give the label a namespaced translation key. Registry validation rejects a
   key without a dot ([`accountSectionRegistry.ts:8-24`](../../../src/features/account/accountSectionRegistry.ts#L8-L24)).
5. Choose an order after existing entries. Do not renumber old sections; the
   current legacy sections establish the preserved order
   ([`legacyAccountSections.tsx:18-51`](../../../src/features/account/legacyAccountSections.tsx#L18-L51)).

## Add a connection card

1. Put the card descriptor in its connector module, beside the connection UI.
2. Augment `ConnectionCardIdMap` with exactly its ID, then use that ID in the
   descriptor.
3. Add one import and one entry to `connectionCardRegistry`; it is the only
   connector-card mount list ([`connectionCardRegistry.ts:1-65`](../../../src/features/account/connectionCardRegistry.ts#L1-L65)).
4. Use `connections` for normal cards. Use `developer-tools` only for tools
   that belong in the collapsed developer area.
5. Supply all three render functions. Compatibility cards may use the same
   renderer for each, as the existing registry does
   ([`connectionCardRegistry.ts:47-64`](../../../src/features/account/connectionCardRegistry.ts#L47-L64)).
6. Keep IDs unique, labels namespaced, and order stable. The registry checks
   duplicate IDs and label namespaces before sorting
   ([`connectionCardRegistry.ts:67-94`](../../../src/features/account/connectionCardRegistry.ts#L67-L94)).

## Check before finishing

Run the focused registry test, then the normal type, lint, boundary, and
translation checks. A made-up section ID and a made-up connector ID should each
fail `tsc --noEmit`; remove those temporary probes before the clean type check.
