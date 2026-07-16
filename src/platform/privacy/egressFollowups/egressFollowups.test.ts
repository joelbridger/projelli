import { describe, expect, it } from 'vitest';
import {
  buildEgressReceipt,
  createEgressApproval,
  EGRESS_OPERATIONS,
  EGRESS_RED_TEAM_FIXTURES,
  formatEgressInventoryMarkdown,
  validateEgressDestination,
  validateEgressSourceManifest,
} from '@/platform/privacy/egressRegistry';

describe('whole-app egress follow-ups', () => {
  it('keeps every Offline Mode and whole-app registration after the registry merge', () => {
    expect([...EGRESS_OPERATIONS.keys()].sort()).toEqual([
      'addepar-import',
      'ai-setup-help',
      'app-update-download',
      'assured-ai',
      'bug-report',
      'calendar-import-ics',
      'calendar-sync-google',
      'calendar-sync-microsoft',
      'calendar-write-google',
      'calendar-write-microsoft',
      'calendly-import',
      'cloud-ai',
      'crm-auth-redtail',
      'crm-auth-salesforce',
      'crm-auth-salesforce-identity',
      'crm-auth-salesforce-instance',
      'crm-auth-wealthbox',
      'crm-migration-import',
      'crm-sync-redtail',
      'crm-sync-salesforce',
      'crm-sync-wealthbox',
      'crm-write-wealthbox',
      'diagnostics',
      'docusign-import',
      'external-navigation',
      'files-sync-box',
      'files-sync-onedrive',
      'files-sync-sharefile',
      'firm-seat-validation',
      'intake-relay',
      'jotform-import',
      'license-api',
      'local-loopback',
      'local-model-download',
      'mail-auth-google',
      'mail-auth-microsoft',
      'mail-save-draft',
      'mail-send',
      'mail-send-imap',
      'mail-sync-gmail',
      'mail-sync-imap',
      'mail-sync-microsoft',
      'marketplace-catalog-download',
      'marketplace-manifest',
      'marketplace-package',
      'marketplace-package-download',
      'mcp-external-client-session',
      'telemetry',
      'updater-github-releases',
      'zocks-import',
    ]);
  });

  it('gives every registered operation an honest approval and receipt contract', () => {
    for (const operation of EGRESS_OPERATIONS.values()) {
      const approval = createEgressApproval(operation.id);
      expect(approval.operationId).toBe(operation.id);
      expect(approval.title).not.toHaveLength(0);
      expect(approval.dataSummary).not.toHaveLength(0);

      const receipt = buildEgressReceipt({
        operationId: operation.id,
        destination:
          operation.destination.allowedOrigins[0] ?? 'user-selected.example',
        result: 'completed',
        consent: 'approved',
        occurredAt: '2026-07-12T00:00:00.000Z',
      });
      expect(receipt.operationId).toBe(operation.id);
      expect(receipt).not.toHaveProperty('messageBody');
      expect(receipt).not.toHaveProperty('recipientAddress');
    }
  });

  it('only permits the documented origin and rejects redirecting token requests', () => {
    expect(
      validateEgressDestination(
        'mail-sync-microsoft',
        'https://graph.microsoft.com/v1.0/me/messages'
      )
    ).toEqual({ ok: true });
    expect(
      validateEgressDestination(
        'mail-sync-microsoft',
        'https://evil.example/messages'
      ).ok
    ).toBe(false);
    expect(
      validateEgressDestination(
        'mail-sync-microsoft',
        'http://graph.microsoft.com/v1.0/me/messages'
      ).ok
    ).toBe(false);

    const microsoft = EGRESS_OPERATIONS.get('mail-sync-microsoft');
    expect(microsoft?.destination.redirects).toBe('deny');
    expect(
      validateEgressDestination(
        'jotform-import',
        'https://api.jotform.com/form/1?apiKey=secret'
      ).ok
    ).toBe(false);
    expect(
      buildEgressReceipt({
        operationId: 'mail-send',
        destination:
          'https://graph.microsoft.com/v1.0/me/sendMail?client_secret=never-store-this',
        result: 'completed',
        consent: 'approved',
        occurredAt: '2026-07-12T00:00:00.000Z',
      }).destination
    ).toBe('graph.microsoft.com');
  });

  it('requires explicit safeguards for user-selected mail and calendar hosts', () => {
    expect(
      validateEgressDestination(
        'mail-sync-imap',
        'imaps://mail.example.test:993'
      )
    ).toEqual({ ok: true });
    expect(
      validateEgressDestination(
        'mail-sync-imap',
        'imap://mail.example.test:143'
      ).ok
    ).toBe(false);
    expect(
      validateEgressDestination(
        'calendar-import-ics',
        'https://calendar.example.test/feed.ics'
      )
    ).toEqual({ ok: true });
    expect(
      validateEgressDestination(
        'calendar-import-ics',
        'http://calendar.example.test/feed.ics'
      ).ok
    ).toBe(false);
    expect(
      validateEgressDestination('calendar-import-ics', 'https://[::1]/feed.ics')
        .ok
    ).toBe(false);
    expect(
      validateEgressDestination(
        'calendar-import-ics',
        'https://169.254.169.254/feed.ics'
      ).ok
    ).toBe(false);
    expect(
      EGRESS_OPERATIONS.get('mail-sync-imap')?.destination
        .requiresResolvedAddressCheck
    ).toBe(true);
    expect(
      validateEgressDestination(
        'crm-migration-import',
        'http://127.0.0.1:8788/v1'
      )
    ).toEqual({ ok: true });
  });

  it('makes a CI manifest fail for an unregistered network capability or missing receipt test', () => {
    expect(
      validateEgressSourceManifest([
        {
          file: 'src/platform/connectors/mail.ts',
          operationId: 'mail-send',
          receiptTest: true,
        },
        {
          file: 'src/platform/new/sink.ts',
          operationId: 'unregistered',
          receiptTest: false,
        },
      ])
    ).toEqual([
      'src/platform/new/sink.ts: operation "unregistered" is not registered',
      'src/platform/new/sink.ts: operation "unregistered" has no receipt test',
    ]);
  });

  it('publishes an inventory and keeps the red-team prompt fixture set broad', () => {
    const inventory = formatEgressInventoryMarkdown();
    expect(inventory).toContain('mail-sync-microsoft');
    expect(inventory).toContain('mcp-external-client-session');
    expect(EGRESS_RED_TEAM_FIXTURES.map((fixture) => fixture.kind)).toEqual([
      'signed-url',
      'oauth-fragment',
      'api-key',
      'mixed-case-secret-label',
      'instruction-text',
      'deceptive-link',
    ]);
  });
});
