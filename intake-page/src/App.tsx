import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { deriveAuthToken, derivePageKey } from '@/platform/intake/intakeCrypto';
import { parseLinkFragment } from '@/platform/intake/intakeLink';
import type { DocUploadRequestItem, GuidedQuestionRequestItem, RequestItem, TypedFieldRequestItem } from '@/platform/intake/types';
import {
  DEFAULT_WELCOME_JOURNEY,
  resolveWelcomeMergeFields,
  sanitizeWelcomeJourney,
  type WelcomeJourney,
} from '@/features/intake/welcomeJourneyDefaults';

import { openPageJson, sealPageJson } from './pageCrypto';
import { RelayClient } from './relayClient';
import { submitAnswer } from './submission';
import type { AnswerPayload, IntakeChecklist, IntakeFirm, ResumeState } from './types';

type LoadState =
  | { status: 'checking' | 'loading' }
  | { status: 'fallback' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      intakeId: string;
      intakePubRaw: Uint8Array;
      pageKey: CryptoKey;
      relay: RelayClient;
      checklist: IntakeChecklist;
      resume: ResumeState;
      finalizedItemIds: Set<string>;
    };

const EMPTY_RESUME: ResumeState = {
  completion_flags: {},
  confirmations: {},
  skipped_item_ids: [],
  pending_uploads: {},
};

const DEFAULT_ACCENT = '#2f7d62';
const DEFAULT_FIRM_NAME = 'Advisor Prep Hero';
const PAGE_FILE_MAX_BYTES = 100 * 1024 * 1024;
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
const SAFE_NAMED_COLORS = new Set([
  'black',
  'blue',
  'gray',
  'green',
  'grey',
  'navy',
  'orange',
  'purple',
  'red',
  'teal',
  'white',
  'yellow',
]);

function isActionable(item: RequestItem): boolean {
  return item.t === 'typed_field' || item.t === 'doc_upload' || item.t === 'guided_question';
}

function isFiniteNumberToken(token: string): boolean {
  return /^-?(?:\d+|\d*\.\d+)$/u.test(token) && Number.isFinite(Number(token));
}

function isCssPercent(token: string): boolean {
  if (!token.endsWith('%')) return false;
  const value = token.slice(0, -1);
  return isFiniteNumberToken(value) && Number(value) >= 0 && Number(value) <= 100;
}

function isRgbChannel(token: string): boolean {
  if (isCssPercent(token)) return true;
  if (!isFiniteNumberToken(token)) return false;
  const value = Number(token);
  return value >= 0 && value <= 255;
}

function isAlphaChannel(token: string): boolean {
  if (isCssPercent(token)) return true;
  if (!isFiniteNumberToken(token)) return false;
  const value = Number(token);
  return value >= 0 && value <= 1;
}

function isHueChannel(token: string): boolean {
  const value = token.replace(/(?:deg|grad|rad|turn)$/iu, '');
  return isFiniteNumberToken(value);
}

function splitCssFunctionArgs(value: string, name: string): string[] | null {
  const match = value.match(new RegExp(`^${name}\\(([^()]*)\\)$`, 'iu'));
  if (!match) return null;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) return null;
  return parts;
}

function isSafeRgbColor(value: string): boolean {
  const parts = splitCssFunctionArgs(value, 'rgba?');
  if (!parts || (parts.length !== 3 && parts.length !== 4)) return false;
  return parts.slice(0, 3).every(isRgbChannel) && (parts.length === 3 || isAlphaChannel(parts[3]));
}

function isSafeHslColor(value: string): boolean {
  const parts = splitCssFunctionArgs(value, 'hsla?');
  if (!parts || (parts.length !== 3 && parts.length !== 4)) return false;
  return isHueChannel(parts[0]) && isCssPercent(parts[1]) && isCssPercent(parts[2]) && (parts.length === 3 || isAlphaChannel(parts[3]));
}

function safeAccentColor(accent: unknown): string {
  if (typeof accent !== 'string') return DEFAULT_ACCENT;
  const value = accent.trim();
  if (HEX_COLOR_RE.test(value)) return value;
  const lower = value.toLowerCase();
  if (SAFE_NAMED_COLORS.has(lower)) return lower;
  if (isSafeRgbColor(lower) || isSafeHslColor(lower)) return value;
  return DEFAULT_ACCENT;
}

function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function normalizeFirm(firm: IntakeChecklist['firm'] | undefined): IntakeFirm {
  // W1-BENCH-FIX-FIRM-NORMALIZE
  return {
    name: safeText(firm?.name, DEFAULT_FIRM_NAME),
    accent: safeAccentColor(firm?.accent),
    advisor_name: safeText(firm?.advisor_name, 'Your advisor'),
    advisor_email: safeText(firm?.advisor_email),
    next_steps: Array.isArray(firm?.next_steps)
      ? firm.next_steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
      : [],
    journey: sanitizeWelcomeJourney(firm?.journey ?? DEFAULT_WELCOME_JOURNEY),
  };
}

function journeyFields(checklist: IntakeChecklist, firm: IntakeFirm, handoffPerson?: string): Record<string, string> {
  const advisorFirstName = firm.advisor_name.split(/\s+/u)[0] || 'Your advisor';
  return {
    client_first_name: checklist.client_first_name,
    firm_name: firm.name,
    advisor_first_name: advisorFirstName,
    advisor_full_name: firm.advisor_name,
    support_first_name: advisorFirstName,
    support_full_name: firm.advisor_name,
    help_contact_label: firm.journey.help_contact_label,
    primary_next_item: checklist.items.find(isActionable)?.label ?? 'the first checklist item',
    paperwork_label: 'account paperwork',
    new_team_member_full_name: handoffPerson ?? advisorFirstName,
  };
}

function journeyText(text: string, checklist: IntakeChecklist, firm: IntakeFirm, handoffPerson?: string): string {
  return resolveWelcomeMergeFields(text, journeyFields(checklist, firm, handoffPerson));
}

function parseClientNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[$€£¥,\s]/gu, '');
  if (!/^-?(?:\d+|\d*\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatByteLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? String(kb) : kb.toFixed(1)} KB`;
  }
  return `${String(bytes)} bytes`;
}

function getUploadRules(item: DocUploadRequestItem): { slotCount: number; requiredSlots: number; maxBytes: number } {
  const requiredSlots = item.label.toLowerCase().includes('license') ? 2 : 1;
  const requestedMaxFiles = item.max_files ?? requiredSlots;
  const slotCount = Math.max(requiredSlots, requestedMaxFiles);
  const maxBytes = Math.min(item.max_bytes ?? PAGE_FILE_MAX_BYTES, PAGE_FILE_MAX_BYTES);
  return { slotCount, requiredSlots, maxBytes };
}

function getIntakeIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/i\/([^/]+)/u);
  return match ? decodeURIComponent(match[1]) : null;
}

async function hasModernWebCrypto(): Promise<boolean> {
  if ((window as unknown as { __INTAKE_FORCE_NO_WEBCRYPTO__?: boolean }).__INTAKE_FORCE_NO_WEBCRYPTO__) return false;
  if (!globalThis.crypto?.subtle) return false;
  try {
    await globalThis.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

function chooseInitialItem(checklist: IntakeChecklist, finalized: Set<string>, resume: ResumeState): string {
  const itemsById = new Map(checklist.items.map((item) => [item.item_id, item]));
  const resumed = resume.current_item_id ? itemsById.get(resume.current_item_id) : undefined;
  const anyDone = finalized.size > 0;
  if (resumed && resumed.t !== 'readonly_card' && !finalized.has(resumed.item_id)) return resumed.item_id;
  if (resumed?.t === 'readonly_card' && !anyDone) return resumed.item_id;
  const welcome = checklist.items.find((item) => item.t === 'readonly_card' && item.item_id.toLowerCase().includes('welcome'));
  if (!anyDone && welcome) return welcome.item_id;
  return checklist.items.find((item) => isActionable(item) && !finalized.has(item.item_id))?.item_id ?? 'completion';
}

function mergeResume(base: ResumeState, next: ResumeState): ResumeState {
  return {
    ...EMPTY_RESUME,
    ...base,
    ...next,
    completion_flags: { ...base.completion_flags, ...next.completion_flags },
    confirmations: { ...base.confirmations, ...next.confirmations },
    pending_uploads: { ...base.pending_uploads, ...next.pending_uploads },
    skipped_item_ids: next.skipped_item_ids ?? base.skipped_item_ids ?? [],
  };
}

export function App(): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      const supported = await hasModernWebCrypto();
      if (!supported) {
        if (!cancelled) setLoadState({ status: 'fallback' });
        return;
      }

      setLoadState({ status: 'loading' });
      try {
        const intakeId = getIntakeIdFromPath();
        if (!intakeId) throw new Error('This link is missing its intake id.');
        const parsed = parseLinkFragment(window.location.hash);
        if ('error' in parsed) throw new Error('This link is not complete. Ask your advisor to send it again.');
        const pageKey = await derivePageKey(parsed.s);
        const auth = await deriveAuthToken(parsed.s);
        const relay = new RelayClient(intakeId, auth.tokenB64);
        const bundle = await relay.fetchBundle();
        const checklist = await openPageJson<IntakeChecklist>(pageKey, bundle.checklist_ciphertext_b64);
        const resume = await openPageJson<ResumeState>(pageKey, bundle.state_ciphertext_b64);
        if (!cancelled) {
          setLoadState({
            status: 'ready',
            intakeId,
            intakePubRaw: parsed.intakePubRaw,
            pageKey,
            relay,
            checklist,
            resume: mergeResume(EMPTY_RESUME, resume),
            finalizedItemIds: new Set(bundle.finalized_item_ids),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'We could not open this secure page. Please reply to the message that brought you here.',
          });
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState.status === 'fallback') return <FallbackScreen />;
  if (loadState.status === 'error') return <ErrorScreen message={loadState.message} onRetry={() => window.location.reload()} />;
  if (loadState.status !== 'ready') return <LoadingScreen />;
  return <ReadyApp {...loadState} />;
}

function LoadingScreen(): JSX.Element {
  return (
    <main className="page-shell">
      <section className="panel" aria-live="polite">
        <p className="eyebrow">Secure intake</p>
        <h1 tabIndex={-1}>Opening your page.</h1>
        <p>Please keep this tab open.</p>
      </section>
    </main>
  );
}

function FallbackScreen(): JSX.Element {
  return (
    <main className="page-shell">
      <section className="panel">
        <p className="eyebrow">Secure intake</p>
        <h1 tabIndex={-1}>Use another way to send this</h1>
        <p>Your browser cannot open this secure page.</p>
        <div className="fallback-list">
          <p>If this is a photo or file, reply to your advisor&apos;s email with it.</p>
          <p>If this asks for a Social Security number, call your advisor and do it together.</p>
        </div>
      </section>
    </main>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <main className="page-shell">
      <section className="panel">
        <p className="eyebrow">Secure intake</p>
        <h1 tabIndex={-1}>We could not open this page.</h1>
        <p>{message}</p>
        <button className="primary-button" type="button" onClick={onRetry}>
          Try again
        </button>
      </section>
    </main>
  );
}

function ReadyApp(props: Extract<LoadState, { status: 'ready' }>): JSX.Element {
  const { checklist, finalizedItemIds, intakeId, intakePubRaw, pageKey, relay } = props;
  const [resume, setResume] = useState<ResumeState>(props.resume);
  const [currentItemId, setCurrentItemId] = useState(() => chooseInitialItem(checklist, finalizedItemIds, props.resume));
  const [localSubmitted, setLocalSubmitted] = useState<Set<string>>(() => new Set());
  const [sessionConfirmations, setSessionConfirmations] = useState<Record<string, string>>({});
  const [replacingItemId, setReplacingItemId] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const actionItems = useMemo(() => checklist.items.filter(isActionable), [checklist.items]);
  const doneIds = useMemo(() => new Set([...finalizedItemIds, ...localSubmitted]), [finalizedItemIds, localSubmitted]);
  const skipped = useMemo(() => new Set(resume.skipped_item_ids ?? []), [resume.skipped_item_ids]);
  const allDone = actionItems.every((item) => doneIds.has(item.item_id) || skipped.has(item.item_id));
  const item = checklist.items.find((entry) => entry.item_id === currentItemId);
  const firm = useMemo(() => normalizeFirm(checklist.firm), [checklist.firm]);
  const journey = firm.journey;
  const accent = firm.accent;

  async function saveResume(next: ResumeState): Promise<void> {
    const merged = mergeResume(resume, next);
    setResume(merged);
    const ciphertext = await sealPageJson(pageKey, merged);
    await relay.saveState({ ciphertext_b64: ciphertext });
  }

  function nextIncomplete(doneOverride = doneIds, skippedOverride = skipped): string {
    return actionItems.find((entry) => !doneOverride.has(entry.item_id) && !skippedOverride.has(entry.item_id))?.item_id ?? 'completion';
  }

  async function moveTo(nextId: string): Promise<void> {
    setCurrentItemId(nextId);
    try {
      await saveResume({ current_item_id: nextId });
    } catch {
      setNotice('Progress saved on this screen. We will try the secure mailbox again soon.');
    }
  }

  async function handleSubmit(itemToSubmit: RequestItem, payload: AnswerPayload, confirmation?: string): Promise<void> {
    setBusyItemId(itemToSubmit.item_id);
    setNotice(null);
    try {
      const pending = resume.pending_uploads?.[itemToSubmit.item_id];
      const selectedFiles = itemToSubmit.t === 'doc_upload' && payload.kind === 'files'
        ? payload.files
        : null;
      const submitSinglePayload = async (
        singlePayload: AnswerPayload,
        allowResume: boolean,
      ): Promise<void> => {
        const resumeSubmissionId = itemToSubmit.t === 'doc_upload' && allowResume && !replacingItemId
          ? pending?.submission_id
          : undefined;
        const resumeContentKeyB64 = itemToSubmit.t === 'doc_upload' && allowResume && !replacingItemId
          ? pending?.content_key_b64
          : undefined;
        await submitAnswer({
          intakeId,
          intakePubRaw,
          item: itemToSubmit,
          payload: singlePayload,
          relay,
          resumeSubmissionId,
          resumeContentKeyB64,
          onPendingUpload: async (pendingUpload) => {
            if (itemToSubmit.t !== 'doc_upload') return;
            try {
              await saveResume({
                pending_uploads: {
                  ...resume.pending_uploads,
                  [itemToSubmit.item_id]: pendingUpload,
                },
              });
            } catch {
              setNotice('The upload started. Keep this page open until it finishes.');
            }
          },
        });
      };

      if (selectedFiles && selectedFiles.length > 1) {
        for (const file of selectedFiles) {
          await submitSinglePayload({ kind: 'files', files: [file] }, false);
        }
      } else {
        await submitSinglePayload(payload, true);
      }

      const nextLocal = new Set(localSubmitted);
      nextLocal.add(itemToSubmit.item_id);
      setLocalSubmitted(nextLocal);
      const nextDone = new Set(doneIds);
      nextDone.add(itemToSubmit.item_id);
      if (confirmation) {
        setSessionConfirmations((existing) => ({ ...existing, [itemToSubmit.item_id]: confirmation }));
      }
      const nextPending = { ...(resume.pending_uploads ?? {}) };
      delete nextPending[itemToSubmit.item_id];
      const nextId = nextIncomplete(nextDone);
      setReplacingItemId(null);
      setCurrentItemId(nextId);
      setNotice(`${itemToSubmit.label} provided${confirmation ? ` ${confirmation}` : '.'}`);
      await saveResume({
        current_item_id: nextId,
        completion_flags: { ...(resume.completion_flags ?? {}), [itemToSubmit.item_id]: true },
        confirmations: { ...(resume.confirmations ?? {}), [itemToSubmit.item_id]: 'Provided' },
        pending_uploads: nextPending,
      });
    } catch {
      setNotice('We could not reach the secure mailbox. Your answer is still here. Try again.');
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleSkip(itemToSkip: RequestItem): Promise<void> {
    const nextSkipped = new Set(skipped);
    nextSkipped.add(itemToSkip.item_id);
    const nextId = nextIncomplete(doneIds, nextSkipped);
    setCurrentItemId(nextId);
    await saveResume({ current_item_id: nextId, skipped_item_ids: Array.from(nextSkipped) });
  }

  const journeyState = resume.journey_state;
  const statusState = journeyState && journeyState !== 'not_started' && journeyState !== 'in_progress'
    ? journeyState
    : null;

  useEffect(() => {
    contentRef.current?.querySelector<HTMLHeadingElement>('h1')?.focus();
  }, [currentItemId, privacyOpen, statusState, allDone, replacingItemId]);

  if (privacyOpen) {
    return <PrivacyScreen checklist={checklist} firm={firm} onBack={() => setPrivacyOpen(false)} />;
  }

  return (
    <main className="page-shell" style={{ '--accent': accent } as CSSProperties}>
      <div className="brand-line">
        <span className="brand-mark" aria-hidden="true" />
        <span>{firm.name}</span>
      </div>

      <ProgressDots items={actionItems} currentId={currentItemId} doneIds={doneIds} onGoTo={(id) => void moveTo(id)} />

      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      <div ref={contentRef}>
      {statusState ? (
        <JourneyStatusScreen checklist={checklist} firm={firm} resume={resume} state={statusState} />
      ) : currentItemId === 'completion' || allDone ? (
        <CompletionScreen checklist={checklist} firm={firm} resume={resume} />
      ) : item?.t === 'readonly_card' ? (
        <WelcomeScreen checklist={checklist} firm={firm} item={item} onLearn={() => setPrivacyOpen(true)} onStart={() => void moveTo(nextIncomplete())} />
      ) : item && doneIds.has(item.item_id) && replacingItemId !== item.item_id ? (
        <ProvidedScreen
          item={item}
          local={localSubmitted.has(item.item_id)}
          confirmation={sessionConfirmations[item.item_id]}
          phoneCompleted={resume.phone_completed_item_ids?.includes(item.item_id) ?? false}
          phoneLabel={journeyText(journey.phone_walkthrough_label, checklist, firm)}
          onReplace={() => setReplacingItemId(item.item_id)}
          onContinue={() => void moveTo(nextIncomplete())}
        />
      ) : item ? (
        <><ResumeBanner checklist={checklist} firm={firm} resume={resume} /><ItemInputScreen
          key={`${item.item_id}:${replacingItemId ?? 'new'}`}
          item={item}
          firmName={firm.name}
          pendingUpload={resume.pending_uploads?.[item.item_id]}
          relay={relay}
          busy={busyItemId === item.item_id}
          onSubmit={(payload, confirmation) => void handleSubmit(item, payload, confirmation)}
          onSkip={() => void handleSkip(item)}
        /></>
      ) : (
        <ErrorScreen message="This checklist item could not be found." onRetry={() => window.location.reload()} />
      )}
      </div>
    </main>
  );
}

function ProgressDots({
  items,
  currentId,
  doneIds,
  onGoTo,
}: {
  items: RequestItem[];
  currentId: string;
  doneIds: Set<string>;
  onGoTo: (id: string) => void;
}): JSX.Element {
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {currentId === 'completion'
          ? `Checklist complete. ${String(doneIds.size)} of ${String(items.length)} items provided.`
          : `Checklist progress: item ${String(Math.max(1, items.findIndex((item) => item.item_id === currentId) + 1))} of ${String(items.length)}.`}
      </p>
      <nav className="progress-dots" aria-label="Checklist progress">
        {items.map((item, index) => {
          const done = doneIds.has(item.item_id);
          const current = currentId === item.item_id;
          const label = `${item.label} ${done ? 'provided' : current ? 'current' : 'to do'}`;
          return (
            <button
              key={item.item_id}
              type="button"
              className={`dot ${done ? 'done' : ''} ${current ? 'current' : ''}`}
              aria-label={label}
              aria-current={current ? 'step' : undefined}
              onClick={() => onGoTo(item.item_id)}
            >
              <span aria-hidden="true">{done ? String(index + 1) : ''}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

function WelcomeScreen({
  checklist,
  firm,
  item,
  onLearn,
  onStart,
}: {
  checklist: IntakeChecklist;
  firm: IntakeFirm;
  item: RequestItem;
  onLearn: () => void;
  onStart: () => void;
}): JSX.Element {
  return (
    <section className="panel">
      <p className="eyebrow">Secure intake</p>
      <h1 tabIndex={-1}>{journeyText(firm.journey.welcome.headline, checklist, firm)}</h1>
      <p>{journeyText(firm.journey.welcome.intro, checklist, firm)}</p>
      <p>{journeyText(firm.journey.welcome.return_note, checklist, firm)}</p>
      <p>
        This page locks your information on your device. Only {firm.name} can unlock what you send.{' '}
        <button className="link-button" type="button" onClick={onLearn}>
          Learn how →
        </button>
      </p>
      <button className="primary-button" type="button" onClick={onStart}>
        {firm.journey.welcome.primary_action}
      </button>
      <JourneyTimeline journey={firm.journey} currentId="welcome" />
    </section>
  );
}

function PrivacyScreen({ checklist, firm, onBack }: { checklist: IntakeChecklist; firm: IntakeFirm; onBack: () => void }): JSX.Element {
  const accent = firm.accent;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="page-shell" style={{ '--accent': accent } as CSSProperties}>
      <section className="panel">
        <p className="eyebrow">Secure intake</p>
        <h1 ref={headingRef} tabIndex={-1}>{journeyText(DEFAULT_WELCOME_JOURNEY.privacy.heading, checklist, firm)}</h1>
        {DEFAULT_WELCOME_JOURNEY.privacy.body.map((line) => <p key={line}>{journeyText(line, checklist, firm)}</p>)}
        <p className="provider-line">{journeyText(DEFAULT_WELCOME_JOURNEY.privacy.footer, checklist, firm)}</p>
        <button className="secondary-button" type="button" onClick={onBack}>
          Back
        </button>
      </section>
    </main>
  );
}

function ProvidedScreen({
  item,
  local,
  confirmation,
  phoneCompleted,
  phoneLabel,
  onReplace,
  onContinue,
}: {
  item: RequestItem;
  local: boolean;
  confirmation?: string;
  phoneCompleted: boolean;
  phoneLabel: string;
  onReplace: () => void;
  onContinue: () => void;
}): JSX.Element {
  return (
    <section className="panel">
      <p className="eyebrow">{local ? 'Provided by you just now' : 'Provided'}</p>
      <h1 tabIndex={-1}>{item.label}</h1>
      <p className="provided-line" role="status">Provided ✓ {confirmation ?? ''}</p>
      {phoneCompleted ? <p>{phoneLabel}</p> : null}
      <div className="button-row">
        <button className="secondary-button" type="button" onClick={onReplace}>
          Replace this answer
        </button>
        <button className="primary-button" type="button" onClick={onContinue}>
          Continue
        </button>
      </div>
    </section>
  );
}

function CompletionScreen({ checklist, firm, resume }: { checklist: IntakeChecklist; firm: IntakeFirm; resume: ResumeState }): JSX.Element {
  const journey = firm.journey;
  return (
    <section className="panel">
      <p className="eyebrow">{firm.name}</p>
      <h1 tabIndex={-1}>{journeyText(journey.completion.heading, checklist, firm)}</h1>
      {journeyText(journey.completion.body, checklist, firm).split('\n\n').map((line) => <p key={line}>{line}</p>)}
      <h2>{journey.completion.section_heading}</h2>
      <p>{journeyText(journey.completion.nothing_needed, checklist, firm)}</p>
      <JourneyTimeline journey={journey} currentId={resume.current_milestone_id ?? 'reviewing'} />
      <TeamBlock checklist={checklist} firm={firm} />
      <HandoffNotice checklist={checklist} firm={firm} handoffPerson={resume.handoff_person_name} />
      <section className="help-block"><h2>{journey.welcome.help_heading}</h2><p>{journey.help_contact_label}</p></section>
    </section>
  );
}

function ResumeBanner({ checklist, firm, resume }: { checklist: IntakeChecklist; firm: IntakeFirm; resume: ResumeState }): JSX.Element | null {
  if (!resume.current_item_id || resume.current_item_id === 'welcome') return null;
  const state = resume.journey_state === 'not_started' ? 'not_started' : 'in_progress';
  const copy = firm.journey.resume[state];
  return <section className="panel resume-banner"><p className="resume-heading">{journeyText(copy.heading, checklist, firm)}</p><p>{journeyText(copy.body, checklist, firm)}</p><JourneyTimeline journey={firm.journey} currentId={resume.current_milestone_id ?? 'information_needed'} compact /></section>;
}

function JourneyStatusScreen({ checklist, firm, resume, state }: { checklist: IntakeChecklist; firm: IntakeFirm; resume: ResumeState; state: Exclude<NonNullable<ResumeState['journey_state']>, 'not_started' | 'in_progress'> }): JSX.Element {
  const copy = firm.journey.resume[state];
  return <section className="panel"><p className="eyebrow">{firm.name}</p><h1 tabIndex={-1}>{journeyText(copy.heading, checklist, firm)}</h1><p>{journeyText(copy.body, checklist, firm)}</p><JourneyTimeline journey={firm.journey} currentId={state === 'signature_ready' ? 'signature_or_transfer' : state === 'active_client' ? 'active_client' : state} /><TeamBlock checklist={checklist} firm={firm} /><HandoffNotice checklist={checklist} firm={firm} handoffPerson={resume.handoff_person_name} /><section className="help-block"><h2>{firm.journey.welcome.help_heading}</h2><p>{firm.journey.help_contact_label}</p></section></section>;
}

function JourneyTimeline({ journey, currentId, compact = false }: { journey: WelcomeJourney; currentId: string; compact?: boolean }): JSX.Element {
  const visible = journey.timeline.filter((step) => step.visible);
  return <section className={compact ? 'journey-timeline compact' : 'journey-timeline'} aria-label="What happens next"><h2>{compact ? journey.active_checklist.timeline_label : journey.welcome.timeline_heading}</h2><ol>{visible.map((step) => <li key={step.id} className={step.id === currentId ? 'current' : ''}><strong>{step.label}</strong><span>{step.description}</span>{step.id === currentId ? <em>Next move: {step.owner}</em> : null}</li>)}</ol></section>;
}

function TeamBlock({ checklist, firm }: { checklist: IntakeChecklist; firm: IntakeFirm }): JSX.Element {
  const people = firm.journey.people.filter((person) => person.id === 'lead_advisor' ? Boolean(firm.advisor_name.trim()) : Boolean(person.name?.trim()));
  if (people.length === 0) return <></>;
  return <section className="team-block"><h2>{firm.journey.welcome.team_heading}</h2><p>{firm.journey.welcome.team_intro}</p>{people.map((person) => { const name = person.name?.trim() || journeyText('[advisor_full_name]', checklist, firm); const initials = person.initials ?? name.split(/\s+/u).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase(); return <article key={person.id} className="team-person"><span className="team-avatar" aria-hidden="true">{initials}</span><strong>{name}</strong><span>{person.role}</span><p>{journeyText(person.ask_about, checklist, firm)}</p>{person.contact ? <p>{person.contact}</p> : null}</article>; })}</section>;
}

function HandoffNotice({ checklist, firm, handoffPerson }: { checklist: IntakeChecklist; firm: IntakeFirm; handoffPerson?: string }): JSX.Element | null {
  if (!handoffPerson?.trim()) return null;
  return <section className="help-block"><h2>{journeyText(firm.journey.handoff.heading, checklist, firm, handoffPerson)}</h2><p>{journeyText(firm.journey.handoff.body, checklist, firm, handoffPerson)}</p></section>;
}

function ItemInputScreen({
  item,
  firmName,
  pendingUpload,
  relay,
  busy,
  onSubmit,
  onSkip,
}: {
  item: RequestItem;
  firmName: string;
  pendingUpload?: { submission_id: string; chunk_count: number };
  relay: RelayClient;
  busy: boolean;
  onSubmit: (payload: AnswerPayload, confirmation?: string) => void;
  onSkip: () => void;
}): JSX.Element {
  if (item.t === 'typed_field') return <TypedFieldScreen item={item} firmName={firmName} busy={busy} onSubmit={onSubmit} onSkip={onSkip} />;
  if (item.t === 'doc_upload') {
    return <DocUploadScreen item={item} pendingUpload={pendingUpload} relay={relay} busy={busy} onSubmit={onSubmit} onSkip={onSkip} />;
  }
  if (item.t === 'guided_question') return <GuidedQuestionScreen item={item} busy={busy} onSubmit={onSubmit} onSkip={onSkip} />;
  return (
    <section className="panel">
      <h1 tabIndex={-1}>{item.label}</h1>
      <p>This item is not ready on this page yet.</p>
      <button className="secondary-button" type="button" onClick={onSkip}>
        Skip for now
      </button>
    </section>
  );
}

function TypedFieldScreen({
  item,
  firmName,
  busy,
  onSubmit,
  onSkip,
}: {
  item: TypedFieldRequestItem;
  firmName: string;
  busy: boolean;
  onSubmit: (payload: AnswerPayload, confirmation?: string) => void;
  onSkip: () => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  const isSsn = item.input === 'ssn';
  const isNumeric = item.input === 'money' || item.input === 'number';
  const inputType = item.input === 'date' ? 'date' : isSsn ? 'password' : item.input === 'money' || item.input === 'number' ? 'text' : 'text';
  const cleanSsn = value.replace(/\D/g, '');
  const parsedNumber = isNumeric ? parseClientNumber(value) : null;
  const numberError = isNumeric && value.trim().length > 0 && parsedNumber === null ? 'Enter a number, like 90,000.' : null;
  const helpId = `${item.item_id}-help`;
  const errorId = `${item.item_id}-error`;
  const disabled = busy || (isSsn ? cleanSsn.length !== 9 : isNumeric ? parsedNumber === null : value.trim().length === 0);
  const autocomplete = isSsn ? 'new-password' : item.input === 'date' ? 'bday' : 'off';

  function submit(): void {
    if (isSsn && cleanSsn.length !== 9) return;
    if (isNumeric && parsedNumber === null) return;
    let payloadValue: string | number = value;
    if (isSsn) payloadValue = cleanSsn;
    if (isNumeric && parsedNumber !== null) payloadValue = parsedNumber;
    const confirmation = isSsn ? `(ending in ${cleanSsn.slice(-4)})` : undefined;
    onSubmit({ kind: 'typed', value: payloadValue, display_value: isSsn ? undefined : value }, confirmation);
  }

  return (
    <section className="panel">
      <p className="eyebrow">{firmName}</p>
      <h1 tabIndex={-1}>{item.label}</h1>
      <p id={helpId}>{item.help_text}{isSsn ? ' Enter 9 digits. This field is hidden as you type.' : ''}</p>
      <label className="field-label" htmlFor={item.item_id}>
        {item.label}
      </label>
      <input
        id={item.item_id}
        className="text-input"
        type={inputType}
        inputMode={isSsn || item.input === 'number' ? 'numeric' : item.input === 'money' ? 'decimal' : undefined}
        autoComplete={autocomplete}
        autoCorrect="off"
        spellCheck={false}
        placeholder={item.placeholder}
        aria-describedby={numberError ? `${helpId} ${errorId}` : helpId}
        aria-invalid={Boolean(numberError)}
        required={item.required}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {numberError ? (
        <p id={errorId} className="format-help" role="alert">
          {numberError}
        </p>
      ) : null}
      <ActionButtons busy={busy} disabled={disabled} onSubmit={submit} onSkip={onSkip} />
    </section>
  );
}

function DocUploadScreen({
  item,
  pendingUpload,
  relay,
  busy,
  onSubmit,
  onSkip,
}: {
  item: DocUploadRequestItem;
  pendingUpload?: { submission_id: string; chunk_count: number; content_key_b64?: string };
  relay: RelayClient;
  busy: boolean;
  onSubmit: (payload: AnswerPayload) => void;
  onSkip: () => void;
}): JSX.Element {
  const rules = useMemo(() => getUploadRules(item), [item]);
  const [files, setFiles] = useState<Array<File | undefined>>(() => Array.from({ length: rules.slotCount }));
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState<number | null>(null);
  const selectedCount = files.filter(Boolean).length;
  const disabled = busy || selectedCount < rules.requiredSlots || Boolean(fileError);
  const fileErrorId = `${item.item_id}-file-error`;

  useEffect(() => {
    let cancelled = false;
    async function loadCount(): Promise<void> {
      if (!pendingUpload) return;
      try {
        const indexes = await relay.fetchUploadedIndexes(item.item_id, pendingUpload.submission_id);
        if (!cancelled) setUploadedCount(indexes.length);
      } catch {
        if (!cancelled) setUploadedCount(null);
      }
    }
    void loadCount();
    return () => {
      cancelled = true;
    };
  }, [item.item_id, pendingUpload, relay]);

  function updateFile(index: number, fileList: FileList | null): void {
    const file = fileList?.[0];
    if (file && file.size > rules.maxBytes) {
      setFiles((existing) => {
        const next = [...existing];
        next[index] = undefined;
        return next;
      });
      setFileError(`This file is too large. Choose a file under ${formatByteLimit(rules.maxBytes)}.`);
      return;
    }
    setFileError(null);
    setFiles((existing) => {
      const next = [...existing];
      next[index] = file;
      return next;
    });
  }

  function submit(): void {
    onSubmit({ kind: 'files', files: files.filter((file): file is File => Boolean(file)) });
  }

  return (
    <section className="panel">
      <p className="eyebrow">Document upload</p>
      <h1 tabIndex={-1}>{item.label}</h1>
      <p>{item.help_text}</p>
      {rules.requiredSlots === 2 ? (
        <div className="framing-guide">
          <strong>Photo guide</strong>
          <p>Use a flat surface. Get all four corners. Front first, back second.</p>
        </div>
      ) : null}
      {pendingUpload ? (
        <p className="notice">
          Your upload did not finish. We found {String(uploadedCount ?? 0)} uploaded parts. Choose the photos again to finish.
        </p>
      ) : null}
      {fileError ? (
        <p id={fileErrorId} className="format-help" role="alert">
          {fileError}
        </p>
      ) : null}
      <div className="upload-slots">
        {Array.from({ length: rules.slotCount }).map((_, index) => {
          const isLicenseSide = rules.requiredSlots === 2 && index < 2;
          const slotName = isLicenseSide ? (index === 0 ? 'front' : 'back') : `file ${String(index + 1)}`;
          const captureId = `${item.item_id}-${slotName}-capture`;
          const fileId = `${item.item_id}-${slotName}-file`;
          const ariaName = isLicenseSide ? `License ${slotName} photo` : `${item.label} ${slotName}`;
          return (
            <div className="upload-slot" key={slotName}>
              <p>{isLicenseSide ? `${slotName[0].toUpperCase()}${slotName.slice(1)} side` : item.label}</p>
              <input
                id={captureId}
                className="sr-only"
                aria-label={ariaName}
                type="file"
                accept={(item.accepted_mime_types ?? ['image/*']).join(',')}
                capture="environment"
                aria-describedby={fileError ? fileErrorId : undefined}
                aria-invalid={Boolean(fileError)}
                onChange={(event) => updateFile(index, event.target.files)}
              />
              <input
                id={fileId}
                className="sr-only"
                aria-label={`Choose ${slotName} file`}
                type="file"
                accept={(item.accepted_mime_types ?? ['image/*']).join(',')}
                aria-describedby={fileError ? fileErrorId : undefined}
                aria-invalid={Boolean(fileError)}
                onChange={(event) => updateFile(index, event.target.files)}
              />
              <div className="button-row">
                <label className="primary-button file-button" htmlFor={captureId}>
                  Take a photo
                </label>
                <label className="secondary-button file-button" htmlFor={fileId}>
                  Choose a file
                </label>
              </div>
              <p className="ready-line">
                {files[index] ? `${slotName} ready` : index < rules.requiredSlots ? `${slotName} needed` : `${slotName} optional`}
              </p>
            </div>
          );
        })}
      </div>
      <ActionButtons busy={busy} disabled={disabled} onSubmit={submit} onSkip={onSkip} />
    </section>
  );
}

function GuidedQuestionScreen({
  item,
  busy,
  onSubmit,
  onSkip,
}: {
  item: GuidedQuestionRequestItem;
  busy: boolean;
  onSubmit: (payload: AnswerPayload) => void;
  onSkip: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<'amount' | 'range' | 'unknown' | null>(null);
  const [amount, setAmount] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const parsedAmount = parseClientNumber(amount);
  const parsedLow = parseClientNumber(low);
  const parsedHigh = parseClientNumber(high);
  const numberError =
    (mode === 'amount' && amount.trim().length > 0 && parsedAmount === null) ||
    (mode === 'range' && ((low.trim().length > 0 && parsedLow === null) || (high.trim().length > 0 && parsedHigh === null)))
      ? 'Enter a number, like 90,000.'
      : null;
  const errorId = `${item.item_id}-error`;
  const disabled =
    busy ||
    !mode ||
    (mode === 'amount' && parsedAmount === null) ||
    (mode === 'range' && (parsedLow === null || parsedHigh === null));
  const amountLabel = item.item_id.toLowerCase().includes('spending') ? 'Monthly amount' : 'Yearly amount';

  function submit(): void {
    if (mode === 'amount' && parsedAmount === null) return;
    if (mode === 'range' && (parsedLow === null || parsedHigh === null)) return;
    const answer =
      mode === 'unknown'
        ? { mode: 'unknown' }
        : mode === 'range'
          ? { mode: 'range', min: parsedLow, max: parsedHigh, currency: 'USD' }
          : { mode: 'amount', amount: parsedAmount, currency: 'USD' };
    onSubmit({ kind: 'guided', answer });
  }

  return (
    <section className="panel">
      <p className="eyebrow">Question</p>
      <h1 tabIndex={-1}>{item.label}</h1>
      <p>{item.prompt}</p>
      <p>{item.help_text}</p>
      <div className="choice-grid">
        <button className="choice-button" type="button" aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>
          Enter an amount
        </button>
        <button className="choice-button" type="button" aria-pressed={mode === 'range'} onClick={() => setMode('range')}>
          Choose a range
        </button>
        <button className="choice-button" type="button" aria-pressed={mode === 'unknown'} onClick={() => setMode('unknown')}>
          I don&apos;t know yet
        </button>
      </div>
      {mode === 'amount' ? (
        <>
          <label className="field-label" htmlFor={`${item.item_id}-amount`}>
            {amountLabel}
          </label>
          <input
            id={`${item.item_id}-amount`}
            className="text-input"
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={numberError ? errorId : undefined}
            aria-invalid={Boolean(numberError)}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </>
      ) : null}
      {mode === 'range' ? (
        <div className="range-grid">
          <label className="field-label" htmlFor={`${item.item_id}-low`}>
            Low amount
          </label>
          <input id={`${item.item_id}-low`} className="text-input" inputMode="decimal" aria-describedby={numberError ? errorId : undefined} aria-invalid={Boolean(numberError)} value={low} onChange={(event) => setLow(event.target.value)} />
          <label className="field-label" htmlFor={`${item.item_id}-high`}>
            High amount
          </label>
          <input id={`${item.item_id}-high`} className="text-input" inputMode="decimal" aria-describedby={numberError ? errorId : undefined} aria-invalid={Boolean(numberError)} value={high} onChange={(event) => setHigh(event.target.value)} />
        </div>
      ) : null}
      {numberError ? (
        <p id={errorId} className="format-help" role="alert">
          {numberError}
        </p>
      ) : null}
      <ActionButtons busy={busy} disabled={disabled} onSubmit={submit} onSkip={onSkip} />
    </section>
  );
}

function ActionButtons({
  busy,
  disabled,
  onSubmit,
  onSkip,
}: {
  busy: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onSkip: () => void;
}): JSX.Element {
  return (
    <div className="action-row">
      <button className="primary-button" type="button" disabled={disabled} onClick={onSubmit}>
        {busy ? 'Saving' : 'Save and continue'}
      </button>
      <button className="quiet-button" type="button" disabled={busy} onClick={onSkip}>
        Skip for now
      </button>
    </div>
  );
}
