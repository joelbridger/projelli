import { describe, expect, it } from 'vitest';
import {
  collectEgressOperations,
  EGRESS_MODULE_REGISTRY,
  validateEgressModuleRegistry,
  type EgressModule,
} from './registry';
import type { EgressOperation } from '../egressFollowups/types';

/**
 * Byte-identical egress policy parity.
 *
 * The signature below captures every enforcement-relevant field of every
 * operation: its id, category, whether it needs a final approval, its data
 * classes, and the full destination policy (schemes, origins, redirect rule,
 * user-selected-host, private-network rejection, resolved-address check, and
 * credential-query forbidding). GOLDEN is the frozen pre-carve surface. If a
 * carve ever adds, removes, reorders, or loosens an operation — a new origin, a
 * relaxed redirect rule, a dropped private-network check — the signature list
 * changes and this test fails. A deliberate future operation must extend GOLDEN
 * in the same change, so the reviewer sees the intended delta explicitly.
 */
function signature(operation: EgressOperation): string {
  const d = operation.destination;
  return [
    operation.id,
    operation.category,
    `final=${String(operation.requiresFinalApproval)}`,
    `data=${[...operation.dataClasses].join('+')}`,
    `schemes=${[...d.allowedSchemes].join('+')}`,
    `origins=${[...d.allowedOrigins].join('+')}`,
    `redirects=${d.redirects}`,
    `userHost=${String(Boolean(d.userSelectedHost))}`,
    `rejectPrivate=${String(Boolean(d.rejectPrivateNetwork))}`,
    `resolvedCheck=${String(Boolean(d.requiresResolvedAddressCheck))}`,
    `forbidCredQuery=${String(Boolean(d.forbidCredentialQuery))}`,
  ].join(' | ');
}

const GOLDEN: readonly string[] = [
  'local-loopback | local-ai | final=false | data=content | schemes=http+https | origins=127.0.0.1+::1 | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'cloud-ai | cloud-ai | final=false | data=content+metadata+credential | schemes=https | origins=api.anthropic.com+api.openai.com+generativelanguage.googleapis.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'license-api | licensing | final=false | data=metadata+credential | schemes=https | origins=licenses.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'firm-seat-validation | licensing | final=false | data=metadata+credential | schemes=https | origins=api.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'updater-github-releases | product-maintenance | final=false | data=metadata+binary-download | schemes=https | origins=github.com+release-assets.githubusercontent.com | redirects=allow-listed-only | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'marketplace-manifest | product-maintenance | final=false | data=metadata+binary-download | schemes=https | origins=raw.githubusercontent.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'marketplace-package | product-maintenance | final=true | data=content+metadata | schemes=https | origins=raw.githubusercontent.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'telemetry | telemetry | final=true | data=metadata | schemes=https | origins=forms.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'diagnostics | diagnostics | final=true | data=metadata | schemes=https | origins=forms.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'external-navigation | navigation | final=true | data=metadata | schemes=https | origins= | redirects=deny | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'bug-report | diagnostics | final=true | data=content+metadata | schemes=https | origins=forms.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'ai-setup-help | diagnostics | final=true | data=content+metadata | schemes=https | origins=forms.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'intake-relay | intake-sync | final=false | data=content+metadata+credential | schemes=https | origins=api.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'mail-auth-microsoft | connector-authentication | final=true | data=metadata+credential | schemes=https | origins=login.microsoftonline.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'mail-auth-google | connector-authentication | final=true | data=metadata+credential | schemes=https | origins=accounts.google.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'mail-sync-microsoft | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=graph.microsoft.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'mail-sync-gmail | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=gmail.googleapis.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'mail-sync-imap | connector-import | final=true | data=content+metadata+credential | schemes=imaps | origins= | redirects=deny | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'mail-send | outgoing-email | final=true | data=content+metadata+credential | schemes=https | origins=graph.microsoft.com+gmail.googleapis.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'mail-send-imap | outgoing-email | final=true | data=content+metadata+credential | schemes=smtps | origins= | redirects=deny | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'mail-save-draft | outgoing-email | final=true | data=content+metadata+credential | schemes=https | origins=graph.microsoft.com+gmail.googleapis.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'calendar-sync-microsoft | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=graph.microsoft.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'calendar-sync-google | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=www.googleapis.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'calendar-import-ics | connector-import | final=true | data=content+metadata | schemes=https | origins= | redirects=deny | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'calendar-write-microsoft | connector-write | final=true | data=content+metadata+credential | schemes=https | origins=graph.microsoft.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'calendar-write-google | connector-write | final=true | data=content+metadata+credential | schemes=https | origins=www.googleapis.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-auth-wealthbox | connector-authentication | final=true | data=metadata+credential | schemes=https | origins=api.crmworkspace.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-sync-wealthbox | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=api.crmworkspace.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-write-wealthbox | connector-write | final=true | data=content+metadata+credential | schemes=https | origins=api.crmworkspace.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-auth-salesforce | connector-authentication | final=true | data=metadata+credential | schemes=https | origins=login.salesforce.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-auth-salesforce-instance | connector-authentication | final=false | data=metadata+credential | schemes=https | origins= | redirects=deny | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'crm-auth-salesforce-identity | connector-authentication | final=false | data=metadata+credential | schemes=https | origins=login.salesforce.com+test.salesforce.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-sync-salesforce | connector-import | final=false | data=content+metadata+credential | schemes=https | origins= | redirects=deny | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'crm-auth-redtail | connector-authentication | final=true | data=metadata+credential | schemes=https | origins=api2.redtailtechnology.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-sync-redtail | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=api2.redtailtechnology.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'crm-migration-import | connector-import | final=true | data=content+metadata+credential | schemes=http+https | origins= | redirects=deny | userHost=true | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'files-sync-onedrive | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=graph.microsoft.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'files-sync-box | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=api.box.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'files-sync-sharefile | connector-import | final=false | data=content+metadata+credential | schemes=https | origins= | redirects=deny | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'docusign-import | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=account-d.docusign.com+www.docusign.net | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'jotform-import | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=api.jotform.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=true',
  'calendly-import | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=api.calendly.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'addepar-import | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=api.addepar.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'zocks-import | connector-import | final=false | data=content+metadata+credential | schemes=https | origins=api.zocks.io | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'assured-ai | assured-inference | final=true | data=content+metadata+credential | schemes=https | origins=api.lanternplatform.app | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'app-update-download | product-maintenance | final=false | data=metadata+binary-download | schemes=https | origins=github.com+release-assets.githubusercontent.com | redirects=allow-listed-only | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'local-model-download | product-maintenance | final=true | data=metadata+binary-download | schemes=https | origins= | redirects=allow-listed-only | userHost=true | rejectPrivate=true | resolvedCheck=true | forbidCredQuery=false',
  'marketplace-catalog-download | product-maintenance | final=false | data=metadata+binary-download | schemes=https | origins=raw.githubusercontent.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'marketplace-package-download | product-maintenance | final=true | data=metadata+binary-download | schemes=https | origins=raw.githubusercontent.com | redirects=deny | userHost=false | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
  'mcp-external-client-session | external-client | final=true | data=content+metadata | schemes=mcp | origins= | redirects=deny | userHost=true | rejectPrivate=false | resolvedCheck=false | forbidCredQuery=false',
];

describe('egress module registry — byte-identical policy parity', () => {
  it('produces exactly the frozen pre-carve operation surface, in order', () => {
    const actual = collectEgressOperations().map(signature);
    expect(actual).toEqual(GOLDEN);
  });

  it('has no duplicate operation id across the slices', () => {
    const ids = collectEgressOperations().map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The signature GOLDEN above freezes ids, scopes, and strictness. This
  // snapshot additionally freezes the *consent copy* (title, approvalText,
  // dataSummary, recipient) of every operation, so a future change that
  // understates what leaves the device — without touching enforcement — still
  // fails parity. The committed snapshot delta is reviewable.
  it('freezes every field of every operation, including consent copy', () => {
    expect(collectEgressOperations()).toMatchSnapshot();
  });

  it('validates the shipped registry with zero structural problems', () => {
    expect(validateEgressModuleRegistry()).toEqual([]);
  });
});

describe('egress module registry — structural validation', () => {
  const goodOp: EgressOperation = {
    id: 'valid-op',
    category: 'connector-import',
    title: 'A valid operation',
    approvalText: 'Approve this.',
    dataSummary: 'Some metadata.',
    dataClasses: ['metadata'],
    requiresFinalApproval: false,
    recipient: 'Someone',
    destination: {
      allowedSchemes: ['https'],
      allowedOrigins: ['example.test'],
      redirects: 'deny',
    },
  };

  it('rejects a duplicate operation id anywhere in the registry', () => {
    const registry: EgressModule[] = [
      { domain: 'a', operations: [goodOp] },
      { domain: 'b', operations: [{ ...goodOp, title: 'Copy' }] },
    ];
    expect(validateEgressModuleRegistry(registry)).toContain(
      'b/valid-op: duplicate operation id "valid-op"'
    );
  });

  it('rejects a missing required field', () => {
    const registry: EgressModule[] = [
      { domain: 'a', operations: [{ ...goodOp, id: '', approvalText: '' }] },
    ];
    const problems = validateEgressModuleRegistry(registry);
    expect(problems).toContain('a/(missing id): required field "id" is empty');
    expect(problems).toContain(
      'a/(missing id): required field "approvalText" is empty'
    );
  });

  it('rejects an empty scheme list and a fixed-origin op with no origins', () => {
    const registry: EgressModule[] = [
      {
        domain: 'a',
        operations: [
          {
            ...goodOp,
            destination: {
              allowedSchemes: [],
              allowedOrigins: [],
              redirects: 'deny',
            },
          },
        ],
      },
    ];
    const problems = validateEgressModuleRegistry(registry);
    expect(problems).toContain(
      'a/valid-op: destination.allowedSchemes must not be empty'
    );
    expect(problems).toContain(
      'a/valid-op: fixed-origin operation must list at least one allowed origin'
    );
  });

  it('keeps the registry append-only and non-empty', () => {
    expect(EGRESS_MODULE_REGISTRY.length).toBeGreaterThan(0);
    // Every registered slice contributes at least one operation.
    for (const module of EGRESS_MODULE_REGISTRY) {
      expect(module.operations.length).toBeGreaterThan(0);
    }
  });
});
