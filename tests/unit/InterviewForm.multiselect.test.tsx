import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InterviewForm } from '@/features/workflows/InterviewForm';
import type { InterviewQuestion } from '@/platform/types/workflow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'workflow.interview.required': 'This field is required',
      'workflow.interview.cancel': 'Cancel',
      'workflow.interview.run': 'Run',
      'workflow.interview.running': 'Running',
      'workflow.interview.select-option': 'Select an option',
    })[key] ?? key,
  }),
}));

let activeMatter: { id: string; name: string; client: string } | null = null;
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => activeMatter,
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (matter: { name: string; client: string; id: string }) => {
    const name = matter.name.trim();
    const client = matter.client.trim();
    if (name && client) return `${client} - ${name}`;
    return name || client || matter.id;
  },
}));

const multiselectQuestion: InterviewQuestion = {
  id: 'privilegeTypes',
  question: 'Privilege types applicable',
  description: 'Select all privilege types you expect to assert.',
  type: 'multiselect',
  required: true,
  options: ['Attorney-client privilege', 'Work product doctrine', 'Both'],
};

describe('InterviewForm multiselect rendering', () => {
  beforeEach(() => {
    activeMatter = null;
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it('renders a control for every multiselect option (regression: multiselect rendered nothing)', () => {
    render(<InterviewForm questions={[multiselectQuestion]} onSubmit={vi.fn()} />);
    // Each option must be selectable on screen — before the fix, NONE rendered,
    // so a required multiselect field could never be satisfied and its workflow
    // (Privilege Log Drafter) was impossible to complete.
    expect(screen.getByText('Attorney-client privilege')).toBeTruthy();
    expect(screen.getByText('Work product doctrine')).toBeTruthy();
    expect(screen.getByText('Both')).toBeTruthy();
  });

  it('blocks submit while a required multiselect has nothing selected, then allows it once selected', () => {
    const onSubmit = vi.fn();
    render(<InterviewForm questions={[multiselectQuestion]} onSubmit={onSubmit} />);

    // Submitting with nothing selected must fail validation.
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('This field is required')).toBeTruthy();

    // Select two options.
    fireEvent.click(screen.getByText('Attorney-client privilege'));
    fireEvent.click(screen.getByText('Work product doctrine'));
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));

    // The answer must reach onSubmit as a non-empty string compatible with the
    // existing string-based template substitution + required check.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0] as Record<string, string>;
    expect(typeof submitted['privilegeTypes']).toBe('string');
    expect(submitted['privilegeTypes']).toContain('Attorney-client privilege');
    expect(submitted['privilegeTypes']).toContain('Work product doctrine');
    expect(submitted['privilegeTypes']).not.toContain('Both');
  });

  it('toggling a selected option off removes it from the answer', () => {
    const onSubmit = vi.fn();
    render(<InterviewForm questions={[multiselectQuestion]} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Both'));
    fireEvent.click(screen.getByText('Both')); // toggle off
    fireEvent.click(screen.getByText('Attorney-client privilege'));
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));
    const submitted = onSubmit.mock.calls[0]![0] as Record<string, string>;
    expect(submitted['privilegeTypes']).toBe('Attorney-client privilege');
  });

  it('autofills the active client name for client-name questions', () => {
    activeMatter = {
      id: 'matter-1',
      client: 'Alice Smith',
      name: 'Retirement Review',
    };
    render(<InterviewForm questions={[{
      id: 'clientName',
      question: 'Client name',
      type: 'text',
      required: true,
    }]} onSubmit={vi.fn()} />);

    expect(screen.getByDisplayValue('Alice Smith')).toBeTruthy();
    expect(screen.queryByDisplayValue('Alice Smith - Retirement Review')).toBeNull();
  });

  it('autofills client file name fields from the active client file name', () => {
    activeMatter = {
      id: 'matter-1',
      client: 'Alice Smith',
      name: 'Retirement Review',
    };
    render(<InterviewForm questions={[{
      id: 'matterName',
      question: 'Client file name',
      type: 'text',
      required: true,
    }]} onSubmit={vi.fn()} />);

    expect(screen.getByDisplayValue('Retirement Review')).toBeTruthy();
  });

  it('scrolls to and highlights the first missing required question on Run', () => {
    render(<InterviewForm questions={[
      {
        id: 'clientName',
        question: 'Client name',
        type: 'text',
        required: true,
      },
      {
        id: 'notes',
        question: 'Notes',
        type: 'textarea',
        required: true,
      },
    ]} onSubmit={vi.fn()} />);

    const clientField = screen.getByTestId('workflow-question-clientName').querySelector('input');
    expect(clientField).toBeTruthy();
    fireEvent.change(clientField!, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));

    const missing = screen.getByTestId('workflow-question-notes');
    expect(missing.className).toContain('ring-2');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
