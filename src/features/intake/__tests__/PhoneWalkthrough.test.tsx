import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhoneWalkthrough } from '../PhoneWalkthrough';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { intakeFactUpsert } from '@/platform/intake/factsStore';
import { fileIntakeDocument } from '@/platform/intake/intakeFiling';
import type { IntakeRecord } from '@/platform/intake/intakeStore';
import type { RequestItem } from '@/platform/intake/types';

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

  it('shows one item at a time and supports next, back, skip, and phone fact writes', async () => {
    render(<PhoneWalkthrough matterId="matter-1" intake={intake()} advisorId="advisor-1" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Date of birth' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Social Security number' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('heading', { name: 'Social Security number' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Date of birth' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1950-01-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(intakeFactUpsert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'dob', value: { t: 'date', v: '1950-01-02' },
      provenance: expect.objectContaining({ channel: 'phone_walkthrough', entered_by: 'advisor-1' }),
    })));
  });

  it('masks SSN input and routes it as restricted', async () => {
    render(<PhoneWalkthrough matterId="matter-1" intake={intake()} advisorId="advisor-1" initialItemId="ssn" onClose={vi.fn()} />);

    const ssn = screen.getByLabelText('Social Security number') as HTMLInputElement;
    expect(ssn.type).toBe('password');
    fireEvent.change(ssn, { target: { value: '123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(intakeFactUpsert).toHaveBeenCalledWith(expect.objectContaining({
      sensitivity: 'restricted', provenance: expect.objectContaining({ channel: 'phone_walkthrough' }),
    })));
  });

  it('updates the shared checklist after phone income is completed', async () => {
    const record = intake();
    useIntakeStore.getState().upsertIntake(record);
    render(<PhoneWalkthrough matterId="matter-1" intake={record} advisorId="advisor-1" initialItemId="income" onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Income'), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(useIntakeStore.getState().intakesById['intake-1']?.items.find((item) => item.itemId === 'income')).toMatchObject({
      state: 'received',
      provenance: expect.objectContaining({ channel: 'phone_walkthrough', label: 'entered by you on a call' }),
    }));
  });

  it('files call-collected documents in the same onboarding folder', async () => {
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
      workspaceService={{ writeFileBinary: vi.fn() } as never} matterFolderPath="/workspace/Sarah"
    />);

    const file = new File(['front'], 'license-front.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose document'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => expect(fileIntakeDocument).toHaveBeenCalledWith(expect.objectContaining({
      matterFolderPath: '/workspace/Sarah', fileName: 'license-front.jpg',
    })));
    expect(useIntakeStore.getState().intakesById['intake-1']?.items[0]).toMatchObject({
      state: 'received', filePath: '/workspace/Sarah/Requests/onboarding/license-front.jpg',
    });
  });
});
