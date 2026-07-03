/**
 * complianceNote.ts — Task 9b: optional compliance summary filed to the CRM.
 *
 * Covers:
 *   - lists every SENT item with its remote receipt, stamps the approval time.
 *   - omits consent lines when consent metadata is absent (pre-Wave-3 sources).
 *   - never includes failed or dismissed items.
 *   - includes a retention-policy line when supplied.
 */

import { describe, expect, it } from 'vitest';
import { composeComplianceNote } from './complianceNote';
import type { ProposedCrmWrite } from '@/platform/state/crmWriteQueueStore';

const sent: ProposedCrmWrite[] = [
  { id: '1', kind: 'note', matterId: 'm1', title: 'Annual review', body: 'x', sourceRef: 'meeting:2026-06-30', status: 'sent', remoteId: 'wb-9' },
  { id: '2', kind: 'task', matterId: 'm1', title: 'Send Roth illustration', body: 'y', dueDate: '2026-07-07', sourceRef: 'meeting:2026-06-30', status: 'sent', remoteId: 'wb-10' },
];

describe('composeComplianceNote', () => {
  it('lists every sent item with its remote receipt and stamps the approval time', () => {
    const { title, body } = composeComplianceNote(sent, {
      clientLabel: 'The Hendersons',
      whenIso: '2026-07-02T14:41:00Z',
      consent: { status: 'noted', method: 'verbal', atIso: '2026-06-30T10:00:00Z' },
    });
    expect(title).toContain('Compliance summary');
    expect(body).toContain('Annual review');
    expect(body).toContain('wb-10');
    expect(body).toContain('Consent: noted (verbal)');
    expect(body).toContain('Approved by the advisor');
  });

  it('omits consent lines when consent metadata is absent (pre-Wave-3 sources)', () => {
    const { body } = composeComplianceNote(sent, { clientLabel: 'X', whenIso: '2026-07-02T14:41:00Z' });
    expect(body).not.toContain('Consent:');
  });

  it('never includes failed or dismissed items', () => {
    const broken: ProposedCrmWrite = { id: '3', kind: 'note', matterId: 'm1', title: 'Broken', body: 'z', sourceRef: 'meeting:2026-06-30', status: 'failed' };
    const mixed: ProposedCrmWrite[] = [...sent, broken];
    const { body } = composeComplianceNote(mixed, { clientLabel: 'X', whenIso: '2026-07-02T14:41:00Z' });
    expect(body).not.toContain('Broken');
  });

  it('includes a retention-policy line when supplied', () => {
    const { body } = composeComplianceNote(sent, {
      clientLabel: 'X',
      whenIso: '2026-07-02T14:41:00Z',
      retentionPolicy: 'Audio deleted after 30 days',
    });
    expect(body).toContain('Retention policy: Audio deleted after 30 days');
  });

  it('omits the retention-policy line when not supplied', () => {
    const { body } = composeComplianceNote(sent, { clientLabel: 'X', whenIso: '2026-07-02T14:41:00Z' });
    expect(body).not.toContain('Retention policy:');
  });

  it('produces an empty "Records filed" section when nothing is sent yet (defensive)', () => {
    const { body } = composeComplianceNote([], { clientLabel: 'X', whenIso: '2026-07-02T14:41:00Z' });
    expect(body).toContain('Records filed:');
    expect(body).not.toContain('wb-');
  });

  // Codex adversarial review catch (Task 9c integration): a field update
  // must not be mislabeled "Task" in a compliance/audit artifact.
  it('labels a sent field-kind item as "Field update", not "Task"', () => {
    const fieldItem: ProposedCrmWrite = {
      id: '4',
      kind: 'field',
      matterId: 'm1',
      title: 'Background information',
      body: '',
      field: 'background_information',
      existingValue: 'Robert owns a rental property.',
      newValue: 'Retiring spring 2027.',
      finalValue: 'Robert owns a rental property. Retiring spring 2027.',
      sourceRef: 'meeting:2026-06-30',
      status: 'sent',
      remoteId: 'wb-11',
    };
    const { body } = composeComplianceNote([fieldItem], { clientLabel: 'X', whenIso: '2026-07-02T14:41:00Z' });
    expect(body).toContain('Field update: "Background information"');
    expect(body).not.toContain('Task: "Background information"');
  });
});
