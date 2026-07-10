import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { deriveAuthToken, derivePageKey } from '@/platform/intake/intakeCrypto';
import { parseLinkFragment } from '@/platform/intake/intakeLink';
import { classifyTier1 } from '@/platform/intake/documentDetectiveRules';
import type { DocumentKind, Tier1Classification } from '@/platform/intake/documentDetectiveTypes';
import type { DocUploadRequestItem, GuidedQuestionRequestItem, RequestItem, TypedFieldRequestItem } from '@/platform/intake/types';

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
const TEXT_SAMPLE_MAX_BYTES = 64 * 1024;
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
  };
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

async function readTextSample(file: File): Promise<string> {
  if (!file.type.startsWith('text/')) return '';
  try {
    return await file.slice(0, TEXT_SAMPLE_MAX_BYTES).text();
  } catch {
    return '';
  }
}

function documentKindLabel(kind: DocumentKind): string {
  const labels: Record<DocumentKind, string> = {
    drivers_license: "a driver's license",
    tax_return: 'a tax return',
    pay_stub: 'a pay stub',
    bank_statement: 'a bank statement',
    brokerage_statement: 'a brokerage statement',
    ira_statement: 'an IRA statement',
    credit_card_statement: 'a credit card statement',
    other_financial: 'a financial document',
    unknown: 'a document',
  };
  return labels[kind];
}

function warningMessage(classification: Extract<Tier1Classification, { verdict: 'warn' }>): string {
  if (classification.reason === 'wrong_side_of_license') {
    return `This looks like the ${classification.side} of a driver's license, but this spot is for the ${classification.expected.side}.`;
  }
  if (classification.reason === 'duplicate_license_side') {
    return `This looks like another ${classification.side} side of a driver's license.`;
  }
  return `This looks like ${documentKindLabel(classification.observed)}, but this request asks for ${documentKindLabel(classification.expected.kind)}.`;
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
        <h1>Opening your page.</h1>
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
        <h1>Use another way to send this</h1>
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
        <h1>We could not open this page.</h1>
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

  const actionItems = useMemo(() => checklist.items.filter(isActionable), [checklist.items]);
  const doneIds = useMemo(() => new Set([...finalizedItemIds, ...localSubmitted]), [finalizedItemIds, localSubmitted]);
  const skipped = useMemo(() => new Set(resume.skipped_item_ids ?? []), [resume.skipped_item_ids]);
  const allDone = actionItems.every((item) => doneIds.has(item.item_id) || skipped.has(item.item_id));
  const item = checklist.items.find((entry) => entry.item_id === currentItemId);
  const firm = useMemo(() => normalizeFirm(checklist.firm), [checklist.firm]);
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
        const slotIndexes = payload.kind === 'files' ? payload.file_slot_indexes ?? [] : [];
        for (const [fileIndex, file] of selectedFiles.entries()) {
          const slotIndex = slotIndexes[fileIndex];
          const documentDetective = payload.kind === 'files' && slotIndex !== undefined
            ? payload.document_detective?.filter((entry) => entry.slot_index === slotIndex)
            : undefined;
          await submitSinglePayload(
            {
              kind: 'files',
              files: [file],
              ...(documentDetective?.length ? { document_detective: documentDetective } : {}),
            },
            false,
          );
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

  if (privacyOpen) {
    return <PrivacyScreen firm={firm} onBack={() => setPrivacyOpen(false)} />;
  }

  return (
    <main className="page-shell" style={{ '--accent': accent } as CSSProperties}>
      <div className="brand-line">
        <span className="brand-mark" aria-hidden="true" />
        <span>{firm.name}</span>
      </div>

      <ProgressDots items={actionItems} currentId={currentItemId} doneIds={doneIds} onGoTo={setCurrentItemId} />

      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      {currentItemId === 'completion' || allDone ? (
        <CompletionScreen firm={firm} />
      ) : item?.t === 'readonly_card' ? (
        <WelcomeScreen checklist={checklist} firm={firm} item={item} onLearn={() => setPrivacyOpen(true)} onStart={() => void moveTo(nextIncomplete())} />
      ) : item && doneIds.has(item.item_id) && replacingItemId !== item.item_id ? (
        <ProvidedScreen
          item={item}
          local={localSubmitted.has(item.item_id)}
          confirmation={sessionConfirmations[item.item_id]}
          onReplace={() => setReplacingItemId(item.item_id)}
          onContinue={() => void moveTo(nextIncomplete())}
        />
      ) : item ? (
        <ItemInputScreen
          key={`${item.item_id}:${replacingItemId ?? 'new'}`}
          item={item}
          firmName={firm.name}
          pendingUpload={resume.pending_uploads?.[item.item_id]}
          relay={relay}
          busy={busyItemId === item.item_id}
          onSubmit={(payload, confirmation) => void handleSubmit(item, payload, confirmation)}
          onSkip={() => void handleSkip(item)}
        />
      ) : (
        <ErrorScreen message="This checklist item could not be found." onRetry={() => window.location.reload()} />
      )}
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
            onClick={() => onGoTo(item.item_id)}
          >
            <span aria-hidden="true">{done ? String(index + 1) : ''}</span>
          </button>
        );
      })}
    </nav>
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
      <h1>{`Hi ${checklist.client_first_name}. Welcome to ${firm.name}.`}</h1>
      <p>{item.help_text || (item.t === 'readonly_card' ? item.body : '')}</p>
      <p>
        This page locks your information on your device. Only {firm.name} can unlock it.{' '}
        <button className="link-button" type="button" onClick={onLearn}>
          Learn how →
        </button>
      </p>
      <button className="primary-button" type="button" onClick={onStart}>
        Start
      </button>
    </section>
  );
}

function PrivacyScreen({ firm, onBack }: { firm: IntakeFirm; onBack: () => void }): JSX.Element {
  const accent = firm.accent;
  return (
    <main className="page-shell" style={{ '--accent': accent } as CSSProperties}>
      <section className="panel">
        <p className="eyebrow">How this stays private</p>
        <h1>Your answers lock before they leave this device.</h1>
        <p>Your browser locks each answer before it sends anything.</p>
        <p>{firm.name} has the key to unlock it.</p>
        <p>Lantern holds the sealed package. Lantern cannot read your answers.</p>
        <p>Email replies use your firm&apos;s email. They are not protected by this page.</p>
        <p>This promise depends on the real Lantern page being sent to you. Your advisor sends it directly.</p>
        <p className="provider-line">Lantern is the technology provider.</p>
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
  onReplace,
  onContinue,
}: {
  item: RequestItem;
  local: boolean;
  confirmation?: string;
  onReplace: () => void;
  onContinue: () => void;
}): JSX.Element {
  return (
    <section className="panel">
      <p className="eyebrow">{local ? 'Provided by you just now' : 'Provided'}</p>
      <h1>{item.label}</h1>
      <p className="provided-line">Provided ✓ {confirmation ?? ''}</p>
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

function CompletionScreen({ firm }: { firm: IntakeFirm }): JSX.Element {
  return (
    <section className="panel">
      <p className="eyebrow">{firm.name}</p>
      <h1>That&apos;s everything for now.</h1>
      <p>Here&apos;s what happens next.</p>
      <ol className="next-list">
        {firm.next_steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
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
      <h1>{item.label}</h1>
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
      <h1>{item.label}</h1>
      <p>{item.help_text}</p>
      {isSsn ? <p className="format-help">Enter 9 digits. This field is hidden as you type.</p> : null}
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
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {numberError ? (
        <p className="format-help" role="alert">
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
  const [classifications, setClassifications] = useState<Record<number, Tier1Classification>>({});
  const [keptAnyway, setKeptAnyway] = useState<Record<number, true>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState<number | null>(null);
  const selectedCount = files.filter(Boolean).length;
  const unresolvedWarning = Object.entries(classifications).some(
    ([index, classification]) => classification.verdict === 'warn' && !keptAnyway[Number(index)],
  );
  const disabled = busy || selectedCount < rules.requiredSlots || Boolean(fileError) || unresolvedWarning;

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

  async function updateFile(index: number, fileList: FileList | null): Promise<void> {
    const file = fileList?.[0];
    if (file && file.size > rules.maxBytes) {
      setFiles((existing) => {
        const next = [...existing];
        next[index] = undefined;
        return next;
      });
      setClassifications((existing) => {
        const next = { ...existing };
        delete next[index];
        return next;
      });
      setKeptAnyway((existing) => {
        const next = { ...existing };
        delete next[index];
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
    setKeptAnyway((existing) => {
      const next = { ...existing };
      delete next[index];
      return next;
    });
    if (!file) {
      setClassifications((existing) => {
        const next = { ...existing };
        delete next[index];
        return next;
      });
      return;
    }

    const textSample = await readTextSample(file);
    setClassifications((existing) => {
      const siblingIndex = rules.requiredSlots === 2 ? (index === 0 ? 1 : 0) : -1;
      const sibling = existing[siblingIndex];
      const siblingLicenseSide = sibling && sibling.verdict !== 'unknown' ? sibling.side : undefined;
      const slotRole = rules.requiredSlots === 2 && index < 2 ? (index === 0 ? 'front' : 'back') : 'file';
      return {
        ...existing,
        [index]: classifyTier1({
          item,
          slotIndex: index,
          slotRole,
          file: { name: file.name, mimeType: file.type, byteSize: file.size, textSample },
          ...(siblingLicenseSide ? { siblingLicenseSide } : {}),
        }),
      };
    });
  }

  function clearFile(index: number): void {
    setFiles((existing) => {
      const next = [...existing];
      next[index] = undefined;
      return next;
    });
    setClassifications((existing) => {
      const next = { ...existing };
      delete next[index];
      return next;
    });
    setKeptAnyway((existing) => {
      const next = { ...existing };
      delete next[index];
      return next;
    });
  }

  function submit(): void {
    const documentDetective = Object.entries(classifications).flatMap(([slotIndex, classification]) => {
      if (classification.verdict !== 'warn') return [];
      return [{
        tier: 'tier1' as const,
        slot_index: Number(slotIndex),
        warning_reason: classification.reason,
        expected: classification.reason === 'wrong_side_of_license' ? classification.expected.side : classification.expected.kind,
        observed: classification.observed,
        ...(classification.side ? { side: classification.side } : {}),
        kept_anyway: Boolean(keptAnyway[Number(slotIndex)]),
      }];
    });
    const selectedSlots = files.flatMap((file, index) => (file ? [{ file, index }] : []));
    onSubmit({
      kind: 'files',
      files: selectedSlots.map(({ file }) => file),
      file_slot_indexes: selectedSlots.map(({ index }) => index),
      ...(documentDetective.length ? { document_detective: documentDetective } : {}),
    });
  }

  return (
    <section className="panel">
      <p className="eyebrow">Document upload</p>
      <h1>{item.label}</h1>
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
        <p className="format-help" role="alert">
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
          const classification = classifications[index];
          const warning = classification?.verdict === 'warn' ? classification : undefined;
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
                onChange={(event) => void updateFile(index, event.target.files)}
              />
              <input
                id={fileId}
                className="sr-only"
                aria-label={`Choose ${slotName} file`}
                type="file"
                accept={(item.accepted_mime_types ?? ['image/*']).join(',')}
                onChange={(event) => void updateFile(index, event.target.files)}
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
              {warning && !keptAnyway[index] ? (
                <div className="document-warning" role="alert">
                  <p>{warningMessage(warning)}</p>
                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={() => clearFile(index)}>
                      Choose a different file
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => setKeptAnyway((existing) => ({ ...existing, [index]: true }))}
                    >
                      Keep this file anyway
                    </button>
                  </div>
                </div>
              ) : null}
              {warning && keptAnyway[index] ? <p className="kept-anyway">You chose to keep this file.</p> : null}
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
      <h1>{item.label}</h1>
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
          <input id={`${item.item_id}-low`} className="text-input" inputMode="decimal" value={low} onChange={(event) => setLow(event.target.value)} />
          <label className="field-label" htmlFor={`${item.item_id}-high`}>
            High amount
          </label>
          <input id={`${item.item_id}-high`} className="text-input" inputMode="decimal" value={high} onChange={(event) => setHigh(event.target.value)} />
        </div>
      ) : null}
      {numberError ? (
        <p className="format-help" role="alert">
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
