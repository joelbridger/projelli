import { useTranslation } from 'react-i18next';

export interface MeetingVisibilityPreferenceMember {
  readonly id: string;
  readonly displayName: string;
}

export type MeetingVisibilityPreferenceState =
  | 'loading'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'error';

interface MeetingVisibilityPreferenceCommonProps {
  /** Identity of the MeetingEntry host that is rendering right now. */
  readonly currentMeetingIdentityKey: string;
  /** Identity attached to the loaded preference snapshot below. */
  readonly preferenceMeetingIdentityKey: string;
  readonly ownerMemberId: string;
  readonly members: readonly MeetingVisibilityPreferenceMember[];
  readonly selectedMemberIds: readonly string[];
  readonly state: MeetingVisibilityPreferenceState;
}

export type MeetingVisibilityPreferenceControlProps =
  MeetingVisibilityPreferenceCommonProps &
    (
      | {
          readonly mode: 'editable';
          readonly onSelectionChange: (change: {
            readonly meetingIdentityKey: string;
            readonly memberIds: readonly string[];
          }) => void;
        }
      | {
          /** Used for an included coworker who is not allowed to change the preference. */
          readonly mode: 'shared-readonly';
          readonly onSelectionChange?: never;
        }
    );

function orderedSelection(
  members: readonly MeetingVisibilityPreferenceMember[],
  selected: ReadonlySet<string>,
  ownerMemberId: string
): readonly string[] {
  return members
    .filter((member) => member.id === ownerMemberId || selected.has(member.id))
    .map((member) => member.id);
}

/**
 * A controlled presentation seam for a meeting's normal coworker visibility.
 * It deliberately performs no reads or writes and makes no security promise.
 */
export function MeetingVisibilityPreferenceControl(
  props: MeetingVisibilityPreferenceControlProps
) {
  const { t } = useTranslation();
  const identityMatches =
    props.currentMeetingIdentityKey.length > 0 &&
    props.currentMeetingIdentityKey === props.preferenceMeetingIdentityKey;

  if (
    !identityMatches ||
    props.state === 'loading' ||
    props.state === 'error'
  ) {
    const messageKey = !identityMatches
      ? 'meetings.entry.visibility-preference.identity-mismatch'
      : props.state === 'error'
        ? 'meetings.entry.visibility-preference.error'
        : 'meetings.entry.visibility-preference.loading';
    const role =
      props.state === 'error' && identityMatches ? 'alert' : 'status';
    return (
      <section
        data-testid="meeting-visibility-preference"
        aria-labelledby="meeting-visibility-preference-title"
      >
        <h3 id="meeting-visibility-preference-title">
          {t('meetings.entry.visibility-preference.title')}
        </h3>
        <p role={role}>{t(messageKey)}</p>
      </section>
    );
  }

  const selected = new Set(props.selectedMemberIds);
  selected.add(props.ownerMemberId);

  const readOnly = props.mode === 'shared-readonly';
  const busy = props.state === 'saving';

  return (
    <section
      data-testid="meeting-visibility-preference"
      aria-labelledby="meeting-visibility-preference-title"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-sm)',
        color: 'var(--kp-navy)',
      }}
    >
      <div>
        <h3 id="meeting-visibility-preference-title" style={{ margin: 0 }}>
          {t('meetings.entry.visibility-preference.title')}
        </h3>
        <p
          style={{
            margin: '4px 0 0',
            color: 'var(--color-muted-foreground)',
            fontSize: 'var(--kp-font-sm)',
          }}
        >
          {readOnly
            ? t('meetings.entry.visibility-preference.shared-with-you')
            : t('meetings.entry.visibility-preference.description')}
        </p>
      </div>

      {!readOnly && (
        <fieldset
          disabled={busy}
          style={{
            border: 0,
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--kp-space-xs)',
          }}
        >
          <legend className="sr-only">
            {t('meetings.entry.visibility-preference.description')}
          </legend>
          {props.members.map((member) => {
            const isOwner = member.id === props.ownerMemberId;
            return (
              <label
                key={member.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <input
                  type="checkbox"
                  data-testid={`meeting-visibility-member-${member.id}`}
                  checked={isOwner || selected.has(member.id)}
                  disabled={isOwner || busy}
                  onChange={(event) => {
                    if (isOwner) return;
                    const next = new Set(selected);
                    if (event.target.checked) next.add(member.id);
                    else next.delete(member.id);
                    props.onSelectionChange({
                      meetingIdentityKey: props.currentMeetingIdentityKey,
                      memberIds: orderedSelection(
                        props.members,
                        next,
                        props.ownerMemberId
                      ),
                    });
                  }}
                />
                <span>{member.displayName}</span>
                {isOwner && (
                  <span
                    style={{
                      color: 'var(--color-muted-foreground)',
                      fontSize: 'var(--kp-font-xs)',
                    }}
                  >
                    {t('meetings.entry.visibility-preference.owner')}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      )}

      <p
        style={{
          margin: 0,
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-xs)',
        }}
      >
        {t('meetings.entry.visibility-preference.boundary-explanation')}
      </p>

      {props.state !== 'ready' && (
        <p role="status" style={{ margin: 0, fontSize: 'var(--kp-font-xs)' }}>
          {t(`meetings.entry.visibility-preference.${props.state}`)}
        </p>
      )}
    </section>
  );
}
