import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FilePlus2, Save } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { MeetingPanelContext } from '../meetingWorkspaceTypes';
import { copyText } from '../noticeClipboard';
import { exportPersistedAgendaToWord } from '../agendaExport';
import {
  meetingAgendaTarget,
  useMeetingAgendaStore,
  type MeetingAgenda,
  type MeetingAgendaReadResult,
  type MeetingAgendaStore,
} from './meetingAgendaStore';

export type MeetingAgendaPanelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly agenda: MeetingAgenda;
      readonly draftBody: string;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
    };

interface MeetingAgendaPanelProps {
  readonly context: MeetingPanelContext;
  readonly store: MeetingAgendaStore;
}

function panelStateFromRead(
  result: MeetingAgendaReadResult
): MeetingAgendaPanelState {
  if (result.kind === 'ready') {
    return {
      kind: 'ready',
      agenda: result.agenda,
      draftBody: result.agenda.body,
    };
  }
  if (result.kind === 'empty') return { kind: 'empty' };
  return { kind: 'error', message: result.message };
}

export function MeetingAgendaPanel({
  context,
  store,
}: MeetingAgendaPanelProps) {
  const { t } = context;
  const target = useMemo(
    () => meetingAgendaTarget(context.canonicalMeeting, context.clientBoundary),
    [context.canonicalMeeting, context.clientBoundary]
  );
  const [state, setState] = useState<MeetingAgendaPanelState>({
    kind: 'loading',
  });
  const [busy, setBusy] = useState<
    'creating' | 'saving' | 'copying' | 'exporting' | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestToken = useRef(0);

  useEffect(() => {
    const token = ++requestToken.current;
    setBusy(null);
    setNotice(null);
    if (!target) {
      setState({
        kind: 'error',
        message: t('meetings.agenda.exact-meeting-required'),
      });
      return () => {
        requestToken.current += 1;
      };
    }
    setState({ kind: 'loading' });
    void store
      .read(target)
      .then((result) => {
        if (requestToken.current === token)
          setState(panelStateFromRead(result));
      })
      .catch((error: unknown) => {
        if (requestToken.current === token) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      requestToken.current += 1;
    };
  }, [store, t, target]);

  const startDraft = async () => {
    if (!target) return;
    const token = ++requestToken.current;
    setBusy('creating');
    setNotice(null);
    const result = await store.create(target);
    if (requestToken.current !== token) return;
    setBusy(null);
    if (result.kind === 'ready') {
      setState({
        kind: 'ready',
        agenda: result.agenda,
        draftBody: result.agenda.body,
      });
      setNotice(t('meetings.agenda.draft-created'));
    } else {
      setState({ kind: 'error', message: result.message });
    }
  };

  const saveDraft = async () => {
    if (!target || state.kind !== 'ready') return;
    const token = ++requestToken.current;
    setBusy('saving');
    setNotice(null);
    const result = await store.save(target, {
      body: state.draftBody,
      expectedRevision: state.agenda.revision,
    });
    if (requestToken.current !== token) return;
    setBusy(null);
    if (result.kind === 'ready') {
      setState({
        kind: 'ready',
        agenda: result.agenda,
        draftBody: result.agenda.body,
      });
      setNotice(t('meetings.agenda.saved'));
    } else {
      setNotice(result.message);
    }
  };

  const copySavedAgenda = async () => {
    if (state.kind !== 'ready' || state.draftBody !== state.agenda.body) return;
    const token = ++requestToken.current;
    setBusy('copying');
    setNotice(null);
    try {
      await copyText(state.agenda.body);
      if (requestToken.current === token) {
        setNotice(t('meetings.agenda.copied'));
      }
    } catch (error) {
      if (requestToken.current === token) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestToken.current === token) setBusy(null);
    }
  };

  const exportSavedAgenda = async () => {
    if (state.kind !== 'ready' || state.draftBody !== state.agenda.body) return;
    const token = ++requestToken.current;
    setBusy('exporting');
    setNotice(null);
    try {
      const result = await exportPersistedAgendaToWord({
        body: state.agenda.body,
        clientLabel: context.clientName,
      });
      if (requestToken.current === token) {
        setNotice(
          t(
            result.kind === 'saved'
              ? 'meetings.agenda.exported'
              : 'meetings.agenda.export-cancelled'
          )
        );
      }
    } catch (error) {
      if (requestToken.current === token) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestToken.current === token) setBusy(null);
    }
  };

  if (state.kind === 'loading') {
    return (
      <div data-testid="meeting-agenda-loading" aria-live="polite">
        {t('meetings.agenda.loading')}
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        data-testid="meeting-agenda-error"
        role="alert"
        style={{ color: 'var(--color-destructive)' }}
      >
        {state.message}
      </div>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div
        data-testid="meeting-agenda-empty"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={{ color: 'var(--color-muted-foreground)' }}>
          {t('meetings.agenda.empty')}
        </div>
        <Button
          data-testid="meeting-agenda-start-draft"
          size="sm"
          variant="secondary"
          iconLeft={FilePlus2}
          loading={busy === 'creating'}
          onClick={() => {
            void startDraft().catch((error: unknown) => {
              setBusy(null);
              setNotice(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          {t('meetings.agenda.start-draft')}
        </Button>
      </div>
    );
  }

  const dirty = state.draftBody !== state.agenda.body;
  const savedBodyEmpty = !state.agenda.body.trim();
  return (
    <div
      data-testid="meeting-agenda-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div
        data-testid="meeting-agenda-provenance"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-xs)',
        }}
      >
        <span>
          {t('meetings.agenda.template')}: {state.agenda.template.label} v
          {String(state.agenda.template.version)}
        </span>
        <span>
          {t('meetings.agenda.sources', {
            count: state.agenda.sources.length,
          })}
        </span>
      </div>
      <textarea
        data-testid="meeting-agenda-editor"
        aria-label={t('meetings.agenda.editor-label')}
        value={state.draftBody}
        onChange={(event) => {
          const draftBody = event.currentTarget.value;
          setState((current) =>
            current.kind === 'ready' ? { ...current, draftBody } : current
          );
          setNotice(null);
        }}
        placeholder={t('meetings.agenda.placeholder')}
        style={{
          minHeight: 260,
          width: '100%',
          resize: 'vertical',
          border: '1px solid var(--kp-divider)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-background)',
          color: 'var(--kp-navy)',
          padding: 12,
          font: 'inherit',
          lineHeight: 1.55,
        }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button
          data-testid="meeting-agenda-save-draft"
          size="sm"
          iconLeft={Save}
          loading={busy === 'saving'}
          disabled={!dirty}
          onClick={() => {
            void saveDraft().catch((error: unknown) => {
              setBusy(null);
              setNotice(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          {t('meetings.agenda.save-draft')}
        </Button>
        <Button
          data-testid="meeting-agenda-copy-share"
          size="sm"
          variant="secondary"
          iconLeft={Copy}
          loading={busy === 'copying'}
          disabled={dirty || savedBodyEmpty}
          onClick={() => {
            void copySavedAgenda().catch((error: unknown) => {
              setBusy(null);
              setNotice(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          {t('meetings.agenda.copy-share')}
        </Button>
        <Button
          data-testid="meeting-agenda-export-word"
          size="sm"
          variant="secondary"
          iconLeft={Download}
          loading={busy === 'exporting'}
          disabled={dirty || savedBodyEmpty}
          onClick={() => {
            void exportSavedAgenda().catch((error: unknown) => {
              setBusy(null);
              setNotice(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          {t('meetings.agenda.export-word')}
        </Button>
      </div>
      {dirty ? (
        <div
          data-testid="meeting-agenda-save-before-sharing"
          style={{ color: 'var(--color-muted-foreground)', fontSize: 12 }}
        >
          {t('meetings.agenda.save-before-sharing')}
        </div>
      ) : null}
      {notice ? (
        <div data-testid="meeting-agenda-notice" aria-live="polite">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

function LiveMeetingAgendaPanel({
  context,
}: Pick<MeetingAgendaPanelProps, 'context'>) {
  const store = useMeetingAgendaStore();
  return <MeetingAgendaPanel context={context} store={store} />;
}

export { LiveMeetingAgendaPanel };
