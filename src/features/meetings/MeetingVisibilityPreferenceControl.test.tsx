import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeetingVisibilityPreferenceControl } from './MeetingVisibilityPreferenceControl';

const members = [
  { id: 'owner', displayName: 'Alex Owner' },
  { id: 'advisor', displayName: 'Bailey Advisor' },
  { id: 'operations', displayName: 'Casey Operations' },
] as const;

describe('MeetingVisibilityPreferenceControl', () => {
  it('keeps the owner selected and locked while reporting controlled coworker changes', () => {
    const onSelectionChange = vi.fn();
    render(
      <MeetingVisibilityPreferenceControl
        mode="editable"
        ownerMemberId="owner"
        members={members}
        selectedMemberIds={['advisor']}
        state="ready"
        onSelectionChange={onSelectionChange}
      />
    );

    expect(screen.getByText('Visibility preference')).toBeInTheDocument();
    expect(
      screen.getAllByText(
        'Choose which coworkers Lantern should show this meeting to.'
      )
    ).toHaveLength(2);
    expect(screen.getByTestId('meeting-visibility-member-owner')).toBeChecked();
    expect(
      screen.getByTestId('meeting-visibility-member-owner')
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId('meeting-visibility-member-operations'));
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      'owner',
      'advisor',
      'operations',
    ]);
    fireEvent.click(screen.getByTestId('meeting-visibility-member-advisor'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['owner']);
  });

  it('shows an included non-owner a read-only shared state without controls', () => {
    render(
      <MeetingVisibilityPreferenceControl
        mode="shared-readonly"
        ownerMemberId="owner"
        members={members}
        selectedMemberIds={['owner', 'advisor']}
        state="ready"
      />
    );

    expect(screen.getByText('Shared with you')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(
      screen.getByText(
        'This organizes normal coworker views. It does not change encryption or security boundaries.'
      )
    ).toBeInTheDocument();
  });

  it.each([
    ['loading', 'Loading visibility preference…'],
    ['saving', 'Saving…'],
    ['saved', 'Saved'],
    ['error', 'The visibility preference could not be saved. Try again.'],
  ] as const)('shows the parent-controlled %s state', (state, message) => {
    render(
      <MeetingVisibilityPreferenceControl
        mode="editable"
        ownerMemberId="owner"
        members={members}
        selectedMemberIds={['owner']}
        state={state}
        onSelectionChange={vi.fn()}
      />
    );
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
