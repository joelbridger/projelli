import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhoneWalkthrough } from '../PhoneWalkthrough';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { intakeFactUpsert } from '@/platform/intake/factsStore';
import { fileIntakeDocument } from '@/platform/intake/intakeFiling';
import type { IntakeRecord } from '@/platform/intake/intakeStore';
import type { RequestItem } from '@/platform/intake/types';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactUpsert: vi.fn(() => Promise.resolve({ fact_id: 'fact-phone-1' })),
}));

vi.mock('@/platform/intake/intakeFiling', () => ({
  fileIntakeDocument: vi.fn(() => Promise.resolve('/workspace/Sarah/Requests/onboarding/license-front.jpg')),
}));

const requestItems: RequestItem[] = [
  { t: 'typed_field', item_id: 'dob', label: 'Date of birth', help_text: 'Use month, day, and year.', required: true, subject: 'primary', fact_kind: 'dob', input: 'date' },
  { t: 'typed_field', item_id: 'ssn', label: 'Social Security number', help_text: 'This is write-only.', required: true, subject: 'primary', fact_kind: 'ssn', input: 'ssn' },
  { t: 'guided_question', item_id: 'income', label: 'Income', help_text: '', required: true, subject: 'household', prompt: 'Annual income', response_format: 'money' },
];

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: 'intake-1', matterId: 'matter-1', clientFirstName: 'Sarah', firmName: 'North Star', status: 'active',
    expiresAt: '2026-08-01T00:00:00.000Z', checklistVersion: 1,
    items: requestItems.map((item) => ({ itemId: item.item_id, label: item.label, state: 'not_started' })),
    requestItems, receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
    ...overrides,
  };
}

describe('PhoneWalkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIntakeStore.getState().resetForTests();
  });

  afterEach(async () => {
    // A historical full-suite failure came from a Radix focus callback after
    // jsdom had already been dismantled. Finish that callback while the DOM
    // still exists instead of leaving a timer for the next worker teardown.
    cleanup();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  });

  it('shows one item at a time and supports next, back, skip, and phone fact writes', async () => {
    render(<PhoneWalkthrough matterId="matter-1" intake={intake()} advisorId="advisor-1" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Date of birth' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Social Security number' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('heading', { name: 'Social Security number' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Date of birth' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1950-01-02' } });
    fireEvent.click(screen.getByRole('button', { name: /(?:Save|Replace) and continue/ }));

    await waitFor(() => { expect(intakeFactUpsert).toHaveBeenCalledTimes(1); });
    const [factWrite] = vi.mocked(intakeFactUpsert).mock.calls[0] ?? [];
    expect(factWrite).toMatchObject({
      kind: 'dob', value: { t: 'date', v: '1950-01-02' },
      provenance: { channel: 'phone_walkthrough', entered_by: 'advisor-1' },
    });
  });

  it('masks SSN input and routes it as restricted', async () => {
    render(<PhoneWalkthrough matterId="matter-1" intake={intake()} advisorId="advisor-1" initialItemId="ssn" onClose={vi.fn()} />);

    const ssn = screen.getByLabelText('Social Security number');
    expect(ssn.getAttribute('type')).toBe('password');
    fireEvent.change(ssn, { target: { value: '123456789' } });
    fireEvent.click(screen.getByRole('button', { name: /(?:Save|Replace) and continue/ }));

    await waitFor(() => { expect(intakeFactUpsert).toHaveBeenCalledTimes(1); });
    const [factWrite] = vi.mocked(intakeFactUpsert).mock.calls[0] ?? [];
    expect(factWrite).toMatchObject({
      sensitivity: 'restricted', provenance: { channel: 'phone_walkthrough' },
    });
  });

  it('updates the shared checklist after phone income is completed', async () => {
    const record = intake();
    useIntakeStore.getState().upsertIntake(record);
    render(<PhoneWalkthrough matterId="matter-1" intake={record} advisorId="advisor-1" initialItemId="income" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Enter an amount' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: /(?:Save|Replace) and continue/ }));

    await waitFor(() => { expect(useIntakeStore.getState().intakesById['intake-1']?.items.find((item) => item.itemId === 'income')).toMatchObject({
      state: 'received', provenance: { channel: 'phone_walkthrough', label: 'entered by you on a call' },
    }); });
  });

  it('lets an advisor choose amount, range, or unknown for every guided question', async () => {
    const spending: RequestItem = {
      t: 'guided_question', item_id: 'spending', label: 'Spending', help_text: '',
      required: true, subject: 'household', prompt: 'Monthly spending', response_format: 'range',
    };
    const incomeItem = requestItems.find((item) => item.item_id === 'income');
    if (!incomeItem) throw new Error('Expected income test item.');
    const incomeRecord = intake({
      requestItems: [incomeItem],
      items: [{ itemId: 'income', label: 'Income', state: 'not_started' }],
    });
    useIntakeStore.getState().upsertIntake(incomeRecord);
    const { rerender } = render(<PhoneWalkthrough matterId="matter-1" intake={incomeRecord} advisorId="advisor-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose a range' }));
    fireEvent.change(screen.getByLabelText('Low amount'), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText('High amount'), { target: { value: '140000' } });
    fireEvent.click(screen.getByRole('button', { name: /(?:Save|Replace) and continue/ }));
    await waitFor(() => { expect(intakeFactUpsert).toHaveBeenCalledWith(expect.objectContaining({
      value: { t: 'range', v: { min: 100000, max: 140000, currency: 'USD' } },
    })); });

    const spendingRecord = intake({
      intakeId: 'intake-2', requestItems: [spending],
      items: [{ itemId: 'spending', label: 'Spending', state: 'not_started' }],
    });
    useIntakeStore.getState().upsertIntake(spendingRecord);
    rerender(<PhoneWalkthrough matterId="matter-1" intake={spendingRecord} advisorId="advisor-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter an amount' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /(?:Save|Replace) and continue/ }));
    await waitFor(() => { expect(intakeFactUpsert).toHaveBeenCalledWith(expect.objectContaining({
      value: { t: 'money', v: { amount: 5000, currency: 'USD' } },
    })); });

    fireEvent.click(screen.getByRole('button', { name: "I don't know yet" }));
    fireEvent.click(screen.getByRole('button', { name: /(?:Save|Replace) and continue/ }));
    await waitFor(() => { expect(intakeFactUpsert).toHaveBeenCalledWith(expect.objectContaining({
      value: { t: 'string', v: "I don't know yet" },
    })); });
  });

  it('does not file or complete an incomplete or over-limit document selection', async () => {
    const license: RequestItem = {
      t: 'doc_upload', item_id: 'drivers_license', label: "Driver's license", help_text: '',
      required: true, subject: 'primary', max_files: 2,
    };
    const record = intake({
      requestItems: [license],
      items: [{ itemId: 'drivers_license', label: "Driver's license", state: 'not_started' }],
    });
    useIntakeStore.getState().upsertIntake(record);
    render(<PhoneWalkthrough
      matterId="matter-1" intake={record} advisorId="advisor-1" onClose={vi.fn()}
      workspaceService={new WorkspaceService()} matterFolderPath="/workspace/Sarah"
    />);

    const file = new File(['front'], 'license-front.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose document'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Choose both sides'); });
    expect(fileIntakeDocument).not.toHaveBeenCalled();
    expect(useIntakeStore.getState().intakesById['intake-1']?.items[0]?.state).toBe('not_started');

    const back = new File(['back'], 'license-back.jpg', { type: 'image/jpeg' });
    const extra = new File(['extra'], 'license-extra.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose document'), { target: { files: [file, back, extra] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Choose no more than 2 files'); });
    expect(fileIntakeDocument).not.toHaveBeenCalled();
  });

  it('rejects an oversized document before it reaches the filing helper', async () => {
    const payStub: RequestItem = {
      t: 'doc_upload', item_id: 'pay_stub', label: 'Pay stub', help_text: '',
      required: true, subject: 'primary', max_files: 1, max_bytes: 2,
    };
    const record = intake({
      requestItems: [payStub],
      items: [{ itemId: 'pay_stub', label: 'Pay stub', state: 'not_started' }],
    });
    useIntakeStore.getState().upsertIntake(record);
    render(<PhoneWalkthrough
      matterId="matter-1" intake={record} advisorId="advisor-1" onClose={vi.fn()}
      workspaceService={new WorkspaceService()} matterFolderPath="/workspace/Sarah"
    />);

    fireEvent.change(screen.getByLabelText('Choose document'), {
      target: { files: [new File(['too large'], 'pay-stub.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('under 2 bytes'); });
    expect(fileIntakeDocument).not.toHaveBeenCalled();
    expect(useIntakeStore.getState().intakesById['intake-1']?.items[0]?.state).toBe('not_started');
  });

  it('files duplicate names at distinct onboarding paths before completing the document item', async () => {
    vi.mocked(fileIntakeDocument).mockImplementation(({ fileName }) => Promise.resolve(
      `/workspace/Sarah/Requests/onboarding/${fileName}`
    ));
    const license: RequestItem = {
      t: 'doc_upload', item_id: 'drivers_license', label: "Driver's license", help_text: '',
      required: true, subject: 'primary', max_files: 2,
    };
    const record = intake({
      requestItems: [license],
      items: [{ itemId: 'drivers_license', label: "Driver's license", state: 'not_started' }],
    });
    useIntakeStore.getState().upsertIntake(record);
    render(<PhoneWalkthrough
      matterId="matter-1" intake={record} advisorId="advisor-1" onClose={vi.fn()}
      workspaceService={new WorkspaceService()} matterFolderPath="/workspace/Sarah"
    />);

    const front = new File(['front'], 'license.jpg', { type: 'image/jpeg' });
    const back = new File(['back'], 'license.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose document'), { target: { files: [front, back] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => { expect(fileIntakeDocument).toHaveBeenCalledTimes(2); });
    const filedNames = vi.mocked(fileIntakeDocument).mock.calls.map(([options]) => options.fileName);
    expect(new Set(filedNames).size).toBe(2);
    expect(filedNames).toEqual(['license.jpg', 'license-2.jpg']);
    expect(useIntakeStore.getState().intakesById['intake-1']?.items[0]).toMatchObject({
      state: 'received', filePath: '/workspace/Sarah/Requests/onboarding/license.jpg',
    });
  });
});
