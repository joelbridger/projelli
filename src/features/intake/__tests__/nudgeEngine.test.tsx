import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '@/platform/types/audit';
import { deriveOnboardingRow } from '@/platform/intake/onboardingModel';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import {
  type IntakeRecord,
  useIntakeStore,
} from '@/platform/intake/intakeStore';
import { buildNudgeDraft } from '@/platform/intake/nudgeDraft';
import { setIntakeNudgeAuditEmitter } from '@/platform/intake/nudgeAudit';
import { NudgeReviewModal } from '../NudgeReviewModal';

type AuditLogEntry = Omit<AuditEntry, 'id' | 'timestamp'>;

const { invokeMock, structuredOutputMock, reconstructAdvisorIntakeLinkMock, accountsBox, failSaveBox } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  structuredOutputMock: vi.fn(),
  reconstructAdvisorIntakeLinkMock: vi.fn(),
  accountsBox: {
    value: [{ provider: 'm365', account: 'default', label: 'Microsoft 365' }],
  },
  failSaveBox: { value: false },
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: invokeMock,
}));

vi.mock('@/platform/intake/advisorIntakeLink', () => ({
  reconstructAdvisorIntakeLink: reconstructAdvisorIntakeLinkMock,
}));

vi.mock('@/features/email/resolveEmailProvider', () => ({
  assertLocalOnlyAllowsSend: vi.fn(),
  resolveEmailProvider: vi.fn(() => Promise.resolve({
    provider: {
      structuredOutput: structuredOutputMock,
      getMetadata: () => ({ model: 'test-model', providerId: 'openai' }),
    },
    providerId: 'openai',
    assuredAvailable: false,
  })),
}));

const now = new Date('2026-07-10T12:00:00.000Z');

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'intake-1',
    matterId: overrides.matterId ?? 'matter-1',
    clientFirstName: overrides.clientFirstName ?? 'Sarah',
    clientEmail: overrides.clientEmail ?? 'sarah@example.test',
    firmName: overrides.firmName ?? 'North Star Planning',
    status: overrides.status ?? 'active',
    link: overrides.link ?? 'https://forms.example.test/i/intake-1#safe-link',
    expiresAt: overrides.expiresAt ?? '2026-08-09T00:00:00.000Z',
    lastClientActivityAt: overrides.lastClientActivityAt ?? '2026-07-01T12:00:00.000Z',
    checklistVersion: 1,
    items: overrides.items ?? [
      { itemId: 'license-back', label: 'License back', state: 'not_started' },
      { itemId: 'income-docs', label: 'Income documents', state: 'needs_followup' },
      { itemId: 'passport', label: 'Passport scan', state: 'accepted' },
    ],
    receivedItems: overrides.receivedItems ?? [],
    flags: overrides.flags ?? [],
    knownSessionIds: overrides.knownSessionIds ?? [],
    knownSubmissionIds: overrides.knownSubmissionIds ?? [],
    nudges: overrides.nudges ?? [],
    publicKeyRawB64: overrides.publicKeyRawB64 ?? 'public-key',
    ...overrides,
  };
}

function rowFor(record: IntakeRecord) {
  return deriveOnboardingRow(record, now, DEFAULT_ONBOARDING_CONFIG);
}

function renderModal(record: IntakeRecord, auditSpy = vi.fn()) {
  useIntakeStore.getState().upsertIntake(record);
  setIntakeNudgeAuditEmitter(auditSpy);
  render(
    <NudgeReviewModal
      open
      intake={record}
      row={rowFor(record)}
      now={now}
      onOpenChange={() => {}}
    />,
  );
}

function commandCalled(command: string): boolean {
  return invokeMock.mock.calls.some((call) => call[0] === command);
}

function commandOrder(command: string): number {
  const index = invokeMock.mock.calls.findIndex((call) => call[0] === command);
  if (index === -1) throw new Error(`${command} was not called.`);
  const order = invokeMock.mock.invocationCallOrder[index];
  if (order === undefined) throw new Error(`${command} had no call order.`);
  return order;
}

function commandPayload(command: string): Record<string, unknown> | undefined {
  const calls = invokeMock.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
  return calls.find(([name]) => name === command)?.[1];
}

function auditEntryAt(calls: AuditLogEntry[][], index: number): AuditLogEntry {
  const call = calls[index];
  if (!call) throw new Error(`Missing audit call ${String(index)}.`);
  const entry = call[0];
  if (!entry) throw new Error(`Missing audit entry ${String(index)}.`);
  return entry;
}

function auditOrderAt(orders: number[], index: number): number {
  const order = orders[index];
  if (order === undefined) throw new Error(`Missing audit order ${String(index)}.`);
  return order;
}

function textAreaValue(testId: string): string {
  const element = screen.getByTestId(testId);
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`${testId} is not a textarea.`);
  return element.value;
}

function inputValue(testId: string): string {
  const element = screen.getByTestId(testId);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${testId} is not an input.`);
  return element.value;
}

describe('nudge engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIntakeStore.getState().resetForTests();
    setIntakeNudgeAuditEmitter(null);
    accountsBox.value = [{ provider: 'm365', account: 'default', label: 'Microsoft 365' }];
    failSaveBox.value = false;
    reconstructAdvisorIntakeLinkMock.mockResolvedValue('https://forms.example.test/i/intake-1#rebuilt-link');
    structuredOutputMock.mockResolvedValue({
      body: 'Hi Sarah, I rewrote this but forgot the exact link and list.',
      citations: [],
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'mail_connected_accounts') return Promise.resolve(accountsBox.value);
      if (command === 'mail_save_draft') {
        if (failSaveBox.value) return Promise.reject(new Error('draft folder unavailable'));
        return Promise.resolve('draft-id-123');
      }
      if (command === 'mail_send') return Promise.reject(new Error('mail_send must never be called'));
      return Promise.resolve(null);
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('builds a deterministic draft from only currently missing item labels', () => {
    const record = intake({
      items: [
        { itemId: 'license-back', label: 'License back', state: 'not_started' },
        { itemId: 'income-docs', label: 'Income documents', state: 'needs_followup' },
        { itemId: 'passport', label: 'Passport scan', state: 'accepted', filePath: '/clients/Sarah/passport-secret.png' },
      ],
    });
    const draft = buildNudgeDraft(rowFor(record), record, DEFAULT_ONBOARDING_CONFIG);

    expect(draft.to).toEqual(['sarah@example.test']);
    expect(draft.missingItemIds).toEqual(['license-back', 'income-docs']);
    expect(draft.bodyText).toContain('License back');
    expect(draft.bodyText).toContain('Income documents');
    expect(draft.bodyText).not.toContain('Passport scan');
    expect(draft.bodyText).not.toContain('passport-secret.png');
  });

  it('rebuilds a missing persisted link before saving a nudge draft', async () => {
    const record = intake();
    delete record.link;
    record.publicKeyRawB64 = 'saved-public-key';
    renderModal(record);

    await waitFor(() => {
      expect(textAreaValue('nudge-review-body')).toContain('https://forms.example.test/i/intake-1#rebuilt-link');
    });
    fireEvent.click(screen.getByTestId('nudge-save-draft'));

    await waitFor(() => {
      expect(commandCalled('mail_save_draft')).toBe(true);
    });
    expect(reconstructAdvisorIntakeLinkMock).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      publicKeyRawB64: 'saved-public-key',
    });
    const bodyHtml = commandPayload('mail_save_draft')?.['bodyHtml'];
    if (typeof bodyHtml !== 'string') throw new Error('Expected saved nudge body HTML.');
    expect(bodyHtml).toContain('https://forms.example.test/i/intake-1#rebuilt-link');
  });

  it('blocks saving a nudge when no onboarding link can be produced', async () => {
    const record = intake();
    delete record.link;
    delete record.publicKeyRawB64;
    renderModal(record);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Regenerate');
    });
    expect(reconstructAdvisorIntakeLinkMock).not.toHaveBeenCalled();
    expect(commandCalled('mail_save_draft')).toBe(false);
    expect(screen.queryByTestId('nudge-save-draft')).toBeNull();
  });

  it('saves a draft through mail_save_draft, never mail_send, and audits intent before outcome', async () => {
    const auditSpy = vi.fn((entry: AuditLogEntry) => entry);
    renderModal(intake(), auditSpy);

    await screen.findByTestId('nudge-review-body');
    fireEvent.click(screen.getByTestId('nudge-save-draft'));

    await waitFor(() => {
      expect(commandCalled('mail_save_draft')).toBe(true);
    });
    expect(commandCalled('mail_send')).toBe(false);
    await waitFor(() => {
      expect(auditSpy).toHaveBeenCalledTimes(2);
    });

    const intent = auditEntryAt(auditSpy.mock.calls, 0);
    const outcome = auditEntryAt(auditSpy.mock.calls, 1);
    expect(intent.action).toBe('intake_nudge');
    expect(outcome.action).toBe('intake_nudge');
    expect(intent.metadata['phase']).toBe('intent');
    expect(outcome.metadata['phase']).toBe('outcome');
    expect(outcome.metadata['auditPairId']).toBe(intent.metadata['auditPairId']);
    expect(intent.metadata['missingItemIds']).toEqual(['license-back', 'income-docs']);
    expect(JSON.stringify([intent, outcome])).not.toContain('Hi Sarah');
    expect(auditOrderAt(auditSpy.mock.invocationCallOrder, 0)).toBeLessThan(commandOrder('mail_save_draft'));
    expect(commandOrder('mail_save_draft')).toBeLessThan(auditOrderAt(auditSpy.mock.invocationCallOrder, 1));

    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored?.nudges).toHaveLength(1);
    expect(stored?.nudges[0]).toMatchObject({
      sequence: 1,
      missingItemIds: ['license-back', 'income-docs'],
      channel: 'email_draft',
      auditPairId: intent.metadata['auditPairId'],
    });
  });

  it('writes a failed outcome and records no attempt when draft save fails', async () => {
    failSaveBox.value = true;
    const auditSpy = vi.fn((entry: AuditLogEntry) => entry);
    renderModal(intake(), auditSpy);

    await screen.findByTestId('nudge-review-body');
    fireEvent.click(screen.getByTestId('nudge-save-draft'));

    await screen.findByRole('alert');
    await waitFor(() => {
      expect(auditSpy).toHaveBeenCalledTimes(2);
    });
    const outcome = auditEntryAt(auditSpy.mock.calls, 1);
    expect(outcome.metadata['phase']).toBe('outcome');
    expect(outcome.metadata['status']).toBe('failed');
    expect(useIntakeStore.getState().intakesById['intake-1']?.nudges).toEqual([]);
  });

  it('blocks a stale draft until it is regenerated', async () => {
    renderModal(intake());

    await screen.findByTestId('nudge-review-body');
    useIntakeStore.getState().updateItem('intake-1', {
      itemId: 'license-back',
      label: 'License back',
      state: 'accepted',
    });
    fireEvent.click(screen.getByTestId('nudge-save-draft'));

    expect((await screen.findByRole('alert')).textContent).toContain('changed');
    expect(commandCalled('mail_save_draft')).toBe(false);

    fireEvent.click(screen.getByTestId('nudge-regenerate'));
    await waitFor(() => {
      expect(screen.getByTestId('nudge-missing-items').textContent).not.toContain('License back');
    });
    fireEvent.click(screen.getByTestId('nudge-save-draft'));
    await waitFor(() => {
      expect(commandCalled('mail_save_draft')).toBe(true);
    });
  });

  it('copies through the nudge audit path and cadence-blocks a second copy', async () => {
    accountsBox.value = [{ provider: 'imap', account: 'firm@example.test', label: 'IMAP mailbox' }];
    const auditSpy = vi.fn((entry: AuditLogEntry) => entry);
    renderModal(intake(), auditSpy);

    const copyButton = await screen.findByTestId('nudge-copy-message');
    fireEvent.click(copyButton);

    const clipboard = navigator.clipboard as Clipboard & { writeText: ReturnType<typeof vi.fn> };
    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    expect(commandCalled('mail_save_draft')).toBe(false);
    expect(commandCalled('mail_send')).toBe(false);
    await waitFor(() => {
      expect(auditSpy).toHaveBeenCalledTimes(2);
    });

    const intent = auditEntryAt(auditSpy.mock.calls, 0);
    const outcome = auditEntryAt(auditSpy.mock.calls, 1);
    expect(intent.metadata['phase']).toBe('intent');
    expect(outcome.metadata['phase']).toBe('outcome');
    expect(outcome.metadata['auditPairId']).toBe(intent.metadata['auditPairId']);
    expect(outcome.metadata['status']).toBe('copied');
    expect(outcome.metadata['channel']).toBe('copied_message');
    expect(outcome.outputs['recipientCount']).toBe(1);
    expect(JSON.stringify([intent, outcome])).not.toContain('Hi Sarah');

    const stored = useIntakeStore.getState().intakesById['intake-1'];
    expect(stored?.nudges).toHaveLength(1);
    expect(stored?.nudges[0]).toMatchObject({
      sequence: 1,
      missingItemIds: ['license-back', 'income-docs'],
      channel: 'email_draft',
      auditPairId: intent.metadata['auditPairId'],
    });

    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('no longer available');
    });
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledTimes(2);
  });

  it('lets AI rewrite body prose only and reasserts the code-owned link and missing list', async () => {
    renderModal(intake());

    await screen.findByTestId('nudge-review-body');
    fireEvent.click(screen.getByTestId('nudge-draft-in-my-voice'));

    await waitFor(() => {
      const body = textAreaValue('nudge-review-body');
      expect(body).toContain('I rewrote this');
      expect(body).toContain('License back');
      expect(body).toContain('Income documents');
      expect(body).toContain('https://forms.example.test/i/intake-1#safe-link');
    });
    expect(inputValue('nudge-review-to')).toBe('sarah@example.test');
    expect(inputValue('nudge-review-subject')).toBe('A few onboarding items for North Star Planning');
  });
});
