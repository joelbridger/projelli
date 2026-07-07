import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { calendarListEvents, calendarSyncAll, CALENDAR_SYNC_EVENT } from '@/platform/utils/calendar-commands';
import { useActiveMatters } from '@/platform/matter/matterStore';
import { buildCalendarMatterMap } from '@/platform/rag/matterResolver';
import { useProfileStore } from '@/platform/profile/profileStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { AuditService } from '@/platform/audit/AuditService';
import { consentModeFor } from './recordingConsentLaw';
import { useNoticeSettings } from './noticeSettings';
import { useMeetingStore } from './meetingStore';
import { buildDisplayName } from './noticeCard/meetingPlatform';
import {
  resolveNoticeCardNameTemplate,
} from './noticeCard/noticeCardSettings';
import {
  AUTO_JOIN_LOOKAHEAD_MS,
  AUTO_JOIN_POLL_MS,
  AUTO_JOIN_STOP_WAIT_MS,
  calendarEventSnapshot,
  discoverAutoJoinMeetings,
  nextAutoJoinAction,
  type AutoJoinAction,
} from './meetingAutoJoin';
import {
  readAutoJoinCalendarPrefs,
  readDisabledAutoJoinEventKeys,
  readPresentedAutoJoinOccurrenceKeys,
  readStartedAutoJoinOccurrenceKeys,
  markAutoJoinOccurrenceStarted,
} from './autoJoinSettings';

const audit = new AuditService('meetings');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForRecordingToStop(): Promise<void> {
  const deadline = Date.now() + AUTO_JOIN_STOP_WAIT_MS;
  while (useMeetingStore.getState().status.recording && Date.now() < deadline) {
    await delay(100);
  }
}

async function stopCurrentRecordingForHandoff(): Promise<void> {
  const stopPromise = useMeetingStore.getState().stopRecording();
  await waitForRecordingToStop();
  if (useMeetingStore.getState().status.recording) {
    await stopPromise;
  } else {
    void stopPromise.catch((err: unknown) => {
      console.debug('[MeetingAutoJoinScheduler] post-handoff stop pipeline failed', err);
    });
  }
}

export function MeetingAutoJoinScheduler() {
  const matters = useActiveMatters();
  const mattersRef = useRef(matters);
  const soloName = useProfileStore((s) => s.soloName);
  const soloNameRef = useRef(soloName);
  const getSetting = useSettingsStore((s) => s.getSetting);
  const getSettingRef = useRef(getSetting);
  const { customScript } = useNoticeSettings();
  const customScriptRef = useRef(customScript);
  const { i18n } = useTranslation();
  const languageRef = useRef(i18n.language);
  const startedKeysRef = useRef<Set<string>>(readStartedAutoJoinOccurrenceKeys());
  const freshFailureLoggedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);

  useEffect(() => {
    mattersRef.current = matters;
  }, [matters]);
  useEffect(() => {
    soloNameRef.current = soloName;
  }, [soloName]);
  useEffect(() => {
    getSettingRef.current = getSetting;
  }, [getSetting]);
  useEffect(() => {
    customScriptRef.current = customScript;
  }, [customScript]);
  useEffect(() => {
    languageRef.current = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    let cancelled = false;

    async function runAction(action: AutoJoinAction): Promise<void> {
      const { candidate } = action;
      startedKeysRef.current.add(candidate.key);
      try {
        if (action.type === 'handoff') {
          await stopCurrentRecordingForHandoff();
        }
        const advisorName = (soloNameRef.current.trim().split(/\s+/)[0] || '').trim();
        const displayName = buildDisplayName(
          resolveNoticeCardNameTemplate(getSettingRef.current),
          advisorName,
          candidate.platform,
        );
        await useMeetingStore.getState().startRecording(candidate.matterId, {
          consentMode: consentModeFor(null),
          calendarEvent: calendarEventSnapshot(candidate.event),
          noticeCustomScript: customScriptRef.current,
          noticeLanguage: languageRef.current,
          noticeCard: {
            joinUrl: candidate.joinUrl,
            platform: candidate.platform,
            displayName,
            meetingTitle: candidate.event.title,
            advisorName,
          },
        });
        markAutoJoinOccurrenceStarted(candidate.key);
        startedKeysRef.current.add(candidate.key);
        await audit.logDurable('meeting_auto_join_started', 'Calendar auto-join started a meeting recording.', {
          metadata: {
            matterId: candidate.matterId,
            calendarEventId: candidate.event.id,
            provider: candidate.event.provider,
            platform: candidate.platform,
            handoff: action.type === 'handoff',
          },
        });
      } catch (err) {
        console.error('[MeetingAutoJoinScheduler] auto-join failed', err);
        if (!readStartedAutoJoinOccurrenceKeys().has(candidate.key)) {
          startedKeysRef.current.delete(candidate.key);
        }
      }
    }

    async function logFreshFailure(action: AutoJoinAction, err: unknown): Promise<void> {
      const key = `${action.candidate.key}:fresh-sync-failed`;
      if (freshFailureLoggedRef.current.has(key)) return;
      freshFailureLoggedRef.current.add(key);
      await audit.logDurable('calendar.sync', 'Calendar auto-join skipped because the calendar could not be verified fresh.', {
        outputs: {
          error: err instanceof Error ? err.message : String(err),
        },
        metadata: {
          matterId: action.candidate.matterId,
          calendarEventId: action.candidate.event.id,
          provider: action.candidate.event.provider,
          platform: action.candidate.platform,
          skippedAutoJoin: true,
        },
      });
    }

    async function verifyFreshAction(nowMs: number): Promise<AutoJoinAction | null> {
      const report = await calendarSyncAll(buildCalendarMatterMap(mattersRef.current));
      if (report.cancelled) {
        throw new Error('Calendar sync was cancelled before auto-join.');
      }
      const events = await calendarListEvents(
        new Date(nowMs - 5 * 60 * 1000).toISOString(),
        new Date(nowMs + AUTO_JOIN_LOOKAHEAD_MS).toISOString(),
      );
      const discovery = discoverAutoJoinMeetings(
        events,
        mattersRef.current,
        readAutoJoinCalendarPrefs(),
        readDisabledAutoJoinEventKeys(),
        nowMs,
      );
      return nextAutoJoinAction(
        discovery.willJoin,
        nowMs,
        useMeetingStore.getState().status.recording,
        startedKeysRef.current,
        readPresentedAutoJoinOccurrenceKeys(),
      );
    }

    async function tick(): Promise<void> {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const nowMs = Date.now();
        const events = await calendarListEvents(
          new Date(nowMs - 5 * 60 * 1000).toISOString(),
          new Date(nowMs + AUTO_JOIN_LOOKAHEAD_MS).toISOString(),
        );
        const discovery = discoverAutoJoinMeetings(
          events,
          mattersRef.current,
          readAutoJoinCalendarPrefs(),
          readDisabledAutoJoinEventKeys(),
          nowMs,
        );
        const action = nextAutoJoinAction(
          discovery.willJoin,
          nowMs,
          useMeetingStore.getState().status.recording,
          startedKeysRef.current,
          readPresentedAutoJoinOccurrenceKeys(),
        );
        if (action) {
          try {
            const freshAction = await verifyFreshAction(Date.now());
            if (freshAction) await runAction(freshAction);
          } catch (err) {
            await logFreshFailure(action, err);
          }
        }
      } catch (err) {
        console.debug('[MeetingAutoJoinScheduler] calendar check failed', err);
      } finally {
        runningRef.current = false;
      }
    }

    void tick().catch((err: unknown) => {
      console.debug('[MeetingAutoJoinScheduler] initial tick failed', err);
    });
    const timer = window.setInterval(() => {
      void tick().catch((err: unknown) => {
        console.debug('[MeetingAutoJoinScheduler] scheduled tick failed', err);
      });
    }, AUTO_JOIN_POLL_MS);
    let stopListen: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        stopListen = await listen(CALENDAR_SYNC_EVENT, () => {
          void tick().catch((err: unknown) => {
            console.debug('[MeetingAutoJoinScheduler] sync-triggered tick failed', err);
          });
        });
      } catch (err) {
        console.debug('[MeetingAutoJoinScheduler] calendar sync listener unavailable', err);
      }
    })().catch((err: unknown) => {
      console.debug('[MeetingAutoJoinScheduler] calendar sync listener setup failed', err);
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stopListen?.();
    };
  }, []);

  return null;
}
