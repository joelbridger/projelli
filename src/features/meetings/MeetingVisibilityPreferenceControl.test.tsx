import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeetingVisibilityPreferenceControl } from './MeetingVisibilityPreferenceControl';

const members = [
  { id: 'owner', displayName: 'Alex Owner' },
  { id: 'advisor', displayName: 'Bailey Advisor' },
  { id: 'operations', displayName: 'Casey Operations' },
] as const;
const meetingA = 'household-a\u0000matter-a\u0000meeting-a';
const meetingB = 'household-b\u0000matter-b\u0000meeting-b';

describe('MeetingVisibilityPreferenceControl', () => {
  it('keeps the owner selected and locked while reporting controlled coworker changes', () => {
    const onSelectionChange = vi.fn();
    render(
      <MeetingVisibilityPreferenceControl
        mode="editable"
        currentMeetingIdentityKey={meetingA}
        preferenceMeetingIdentityKey={meetingA}
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
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      meetingIdentityKey: meetingA,
      memberIds: ['owner', 'advisor', 'operations'],
    });
    fireEvent.click(screen.getByTestId('meeting-visibility-member-advisor'));
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      meetingIdentityKey: meetingA,
      memberIds: ['owner'],
    });
  });

  it('shows an included non-owner a read-only shared state without controls', () => {
    render(
      <MeetingVisibilityPreferenceControl
        mode="shared-readonly"
        currentMeetingIdentityKey={meetingA}
        preferenceMeetingIdentityKey={meetingA}
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
        currentMeetingIdentityKey={meetingA}
        preferenceMeetingIdentityKey={meetingA}
        ownerMemberId="owner"
        members={members}
        selectedMemberIds={['owner']}
        state={state}
        onSelectionChange={vi.fn()}
      />
    );
    expect(screen.getByText(message)).toBeInTheDocument();
    if (state === 'error' || state === 'loading') {
      expect(screen.queryByText('Alex Owner')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    } else {
      expect(screen.getByText('Alex Owner')).toBeInTheDocument();
    }
  });

  it.each(['saved', 'error'] as const)(
    'hides stale Meeting A choices when Meeting B renders during a late %s result',
    (lateState) => {
      const { rerender } = render(
        <MeetingVisibilityPreferenceControl
          mode="editable"
          currentMeetingIdentityKey={meetingA}
          preferenceMeetingIdentityKey={meetingA}
          ownerMemberId="owner"
          members={members}
          selectedMemberIds={['owner', 'advisor']}
          state="ready"
          onSelectionChange={vi.fn()}
        />
      );
      expect(screen.getByText('Bailey Advisor')).toBeInTheDocument();

      rerender(
        <MeetingVisibilityPreferenceControl
          mode="editable"
          currentMeetingIdentityKey={meetingB}
          preferenceMeetingIdentityKey={meetingA}
          ownerMemberId="owner"
          members={members}
          selectedMemberIds={['owner', 'advisor']}
          state={lateState}
          onSelectionChange={vi.fn()}
        />
      );

      expect(
        screen.getByText("Loading this meeting's visibility preference…")
      ).toBeInTheDocument();
      expect(screen.queryByText('Alex Owner')).not.toBeInTheDocument();
      expect(screen.queryByText('Bailey Advisor')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          'The visibility preference could not be saved. Try again.'
        )
      ).not.toBeInTheDocument();
    }
  );

  it('keeps valid same-meeting choices visible while saving and after save', () => {
    const props = {
      mode: 'editable' as const,
      currentMeetingIdentityKey: meetingB,
      preferenceMeetingIdentityKey: meetingB,
      ownerMemberId: 'owner',
      members,
      selectedMemberIds: ['owner', 'operations'],
      onSelectionChange: vi.fn(),
    };
    const { rerender } = render(
      <MeetingVisibilityPreferenceControl {...props} state="saving" />
    );
    expect(screen.getByText('Casey Operations')).toBeInTheDocument();
    expect(
      screen.getByTestId('meeting-visibility-member-operations')
    ).toBeDisabled();

    rerender(<MeetingVisibilityPreferenceControl {...props} state="saved" />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(
      screen.getByTestId('meeting-visibility-member-operations')
    ).toBeChecked();
  });
});
