import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useMeetingArtifactStore,
  useMeetingFoundationStore,
} from '../foundation/contract';
import type { MeetingPanelContext } from '../meetingWorkspaceTypes';
import { FollowUpDraftsOnlyEditor } from './FollowUpDraftsOnlyEditor';
import {
  createMeetingFollowUpStore,
  meetingFollowUpTarget,
  type MeetingFollowUpDraft,
  type MeetingFollowUpReadResult,
  type MeetingFollowUpStore,
  type MeetingFollowUpTarget,
} from './meetingFollowUpStore';

export interface MeetingFollowUpPanelProps {
  readonly context: MeetingPanelContext;
  /** Test seam. Production uses the sealed meeting artifact store. */
  readonly store?: MeetingFollowUpStore;
}

type PanelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-produced' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'ready';
      readonly target: MeetingFollowUpTarget;
      readonly draft: MeetingFollowUpDraft;
      readonly savedToDrafts: boolean;
      readonly artifactId: string;
      readonly draftProvider?: 'm365' | 'gmail';
      readonly handoffState?: 'idle' | 'opened-drafts' | 'open-failed';
    };

function stateFromRead(
  result: MeetingFollowUpReadResult,
  target: MeetingFollowUpTarget
): PanelState {
  if (result.kind !== 'ready') return result;
  return {
    kind: 'ready',
    target,
    draft: {
      to: result.recap.to,
      subject: result.recap.subject,
      body: result.recap.body,
    },
    savedToDrafts: result.recap.state === 'saved-to-drafts',
    artifactId: result.recap.artifactId,
    ...(result.recap.draftProvider
      ? { draftProvider: result.recap.draftProvider }
      : {}),
  };
}

function exactIdentity(context: MeetingPanelContext): string | null {
  const target = meetingFollowUpTarget(
    context.canonicalMeeting,
    context.clientBoundary
  );
  return target
    ? [
        target.client.householdRef,
        target.client.matterId,
        target.meetingId,
      ].join('\u0000')
    : null;
}

export function MeetingFollowUpPanel({
  context,
  store,
}: MeetingFollowUpPanelProps) {
  const identity = exactIdentity(context);
  const target = meetingFollowUpTarget(
    context.canonicalMeeting,
    context.clientBoundary
  );
  const [state, setState] = useState<PanelState>(
    target ? { kind: 'loading' } : { kind: 'refused' }
  );
  const readToken = useRef(0);
  const [retry, setRetry] = useState(0);

  const startRecap = () => {
    if (!target || !store) {
      setState({ kind: target ? 'error' : 'refused' });
      return;
    }
    const token = ++readToken.current;
    setState({ kind: 'loading' });
    void store
      .start(target)
      .then((result) => {
        if (readToken.current !== token) return;
        setState(stateFromRead(result, target));
      })
      .catch(() => {
        if (readToken.current === token) setState({ kind: 'error' });
      });
  };

  useEffect(() => {
    const token = ++readToken.current;
    void Promise.resolve()
      .then(async () => {
        if (!target || !store) {
          if (readToken.current === token) {
            setState({ kind: target ? 'error' : 'refused' });
          }
          return;
        }
        setState({ kind: 'loading' });
        const result = await store.read(target);
        if (readToken.current !== token) return;
        setState(stateFromRead(result, target));
      })
      .catch(() => {
        if (readToken.current === token) setState({ kind: 'error' });
      });
    // `identity` is the stable scalar projection of the exact target. Depending
    // on the freshly allocated target object would rerun this read every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, retry, store]);

  if (state.kind === 'loading') {
    return (
      <div data-testid="meeting-follow-up-loading" aria-live="polite">
        {context.t('meetings.entry.follow-up.loading')}
      </div>
    );
  }
  if (state.kind === 'not-produced') {
    return (
      <div
        data-testid="meeting-follow-up-not-produced"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span>{context.t('meetings.entry.follow-up.not-produced')}</span>
        <button
          type="button"
          data-testid="meeting-follow-up-start"
          onClick={startRecap}
          style={{ alignSelf: 'flex-start' }}
        >
          {context.t('common.actions.create')}{' '}
          {context.t('meetings.entry.tab-follow-up')}
        </button>
      </div>
    );
  }
  if (state.kind === 'refused') {
    return (
      <div data-testid="meeting-follow-up-refused" role="alert">
        {context.t('meetings.entry.follow-up.refused')}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div
        data-testid="meeting-follow-up-local-error"
        role="alert"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span>{context.t('meetings.entry.follow-up.local-error')}</span>
        <button
          type="button"
          data-testid="meeting-follow-up-retry"
          onClick={() => {
            setRetry((value) => value + 1);
          }}
          style={{ alignSelf: 'flex-start' }}
        >
          {context.t('meetings.entry.follow-up.retry')}
        </button>
      </div>
    );
  }

  if (!store) return null;

  return (
    <section
      data-testid="meeting-follow-up-panel"
      data-meeting-follow-up-identity={identity ?? undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div
        style={{
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-xs)',
        }}
      >
        {context.t('meetings.entry.follow-up.description')}
      </div>
      <FollowUpDraftsOnlyEditor
        key={state.artifactId}
        meetingId={state.target.meetingId}
        householdRef={state.target.client.householdRef}
        matterId={state.target.client.matterId}
        draft={state.draft}
        savedToDrafts={state.savedToDrafts}
        {...(state.draftProvider
          ? { savedProvider: state.draftProvider }
          : {})}
        {...(state.handoffState
          ? { initialHandoffState: state.handoffState }
          : {})}
        onDraftChange={(draft) => {
          setState((current) =>
            current.kind === 'ready'
              ? { ...current, draft, savedToDrafts: false }
              : current
          );
        }}
        onDraftSaved={async (saved) => {
          const result = await store.save(state.target, {
            ...saved.draft,
            state: 'saved-to-drafts',
            outlookDraftId: saved.draftId,
            draftProvider: saved.provider,
          });
          if (result.kind !== 'ready') {
            throw new Error('Local meeting status update failed.');
          }
          const next = stateFromRead(result, state.target);
          if (next.kind !== 'ready') {
            throw new Error('Local meeting status update failed.');
          }
          setState({
            ...next,
            draftProvider: saved.provider,
            handoffState: saved.handoffState,
          });
        }}
      />
    </section>
  );
}

/** Production binding to the same typed artifact conventions as Tasks/CRM. */
export function LiveMeetingFollowUpPanel({
  context,
}: Pick<MeetingFollowUpPanelProps, 'context'>) {
  const meetings = useMeetingFoundationStore();
  const artifacts = useMeetingArtifactStore();
  const store = useMemo(
    () => createMeetingFollowUpStore(meetings, artifacts),
    [artifacts, meetings]
  );
  return <MeetingFollowUpPanel context={context} store={store} />;
}
