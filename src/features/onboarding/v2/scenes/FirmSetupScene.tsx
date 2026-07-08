/* eslint-disable lantern-i18n/no-hardcoded-string */
/**
 * FirmSetupScene — "3. Setting up your firm".
 *
 * Driven entirely by the REAL setup-progress backend via useSetupProgress():
 * the AI model download, email import, Wealthbox import, and file indexing all
 * show live green bars sourced from the actual Tauri events. The "Building your
 * Client Maps" callout reflects real matter/client-map counts. Nothing here is
 * faked; off-desktop (browser/dev) the hook returns null and we show an idle
 * state.
 *
 * The "Continue to the app" button lives in the shell — pressing it completes
 * onboarding while these imports keep running in the background.
 */

import { useState } from 'react';
import { useSetupProgress } from '@/platform/hooks/useSetupProgress';
import type { SetupProgress } from '@/platform/utils/setup-progress-commands';
import { retryFailedModelDownloads } from '@/platform/utils/setup-progress-commands';
import { getVerifiedProviders } from '@/platform/providers/keyVerification';

import { ProgressRow } from '../components/ProgressRow';
import { ONB_COPY, ONB_EXAMPLE_QUESTIONS } from '../copy';

interface Area {
  key: string;
  label: string;
  pct: number | null;
  done: boolean;
  active: boolean;
  failed?: boolean;
  status: string;
  detail?: string | undefined;
}

function statusText(done: boolean, active: boolean, pct: number | null, failed = false): string {
  if (failed) return 'Failed';
  if (done) return 'Done';
  if (active) return pct != null ? `${String(pct)}%` : 'Working';
  return 'Not started';
}

/** AI brain row (cloud key = ready only once verified; local = live download
 *  percent). A cloud key that was saved but never passed a live check (e.g.
 *  saved while the provider was unreachable) is "saved, not verified" — NOT
 *  "ready" — so we don't over-promise. It verifies on first real use. */
function aiArea(p: SetupProgress): Area {
  const { ai } = p;
  const failed =
    ai.searchModel.state === 'failed' ||
    ai.state === 'failed' ||
    (!ai.cloudKeyPresent && ai.localLlm.state === 'failed');
  // The Rust side reports a cloud key as ai.state === 'ready' the moment a key is
  // present. Honesty gate: a cloud key is only truly "ready" once a real live
  // check verified it (keyVerification marker).
  const cloudUnverified =
    !failed && ai.mode === 'cloud' && ai.cloudKeyPresent && getVerifiedProviders().size === 0;
  const done = !failed && !cloudUnverified && ai.state === 'ready';
  const active = ai.state === 'downloading';
  const pct = failed || done ? 100 : active ? (ai.percent ?? null) : 0;
  const label = failed
    ? 'AI setup needs a retry'
    : cloudUnverified
      ? 'AI key saved, not verified yet'
      : ai.mode === 'cloud'
        ? 'Your AI provider is connected'
        : ONB_COPY.firm.aiLabel;
  const status = cloudUnverified ? 'Not verified' : statusText(done, active, pct, failed);
  return { key: 'ai', label, pct, done, active, failed, status };
}

function importAreas(p: SetupProgress): Area[] {
  const { email, crm, fileIndex, oneDrive } = p;

  const emailDone = email.connected && !email.syncing;
  const emailArea: Area = {
    key: 'email',
    label: 'Email',
    pct: email.connected ? (email.syncing ? null : 100) : 0,
    done: emailDone,
    active: email.syncing,
    status: statusText(emailDone, email.syncing, email.syncing ? null : email.connected ? 100 : 0),
    detail: email.messagesImported != null ? `${email.messagesImported.toLocaleString()} imported` : undefined,
  };

  const crmDone = crm.connected && !crm.syncing;
  const crmArea: Area = {
    key: 'crm',
    label: 'Wealthbox',
    pct: crm.connected ? (crm.syncing ? null : 100) : 0,
    done: crmDone,
    active: crm.syncing,
    status: statusText(crmDone, crm.syncing, crm.syncing ? null : crm.connected ? 100 : 0),
    detail: crm.connected ? `${String(crm.householdsProcessed)} households` : undefined,
  };

  const oneDriveDone = !oneDrive.syncing && (oneDrive.itemsImported ?? 0) > 0;
  const oneDriveArea: Area = {
    key: 'onedrive',
    label: 'OneDrive',
    pct: oneDrive.syncing ? null : oneDriveDone ? 100 : 0,
    done: oneDriveDone,
    active: oneDrive.syncing,
    status: statusText(oneDriveDone, oneDrive.syncing, oneDrive.syncing ? null : oneDriveDone ? 100 : 0),
    detail:
      oneDrive.itemsImported != null
        ? `${oneDrive.itemsImported.toLocaleString()} imported`
        : oneDrive.itemsChecked != null
          ? `${oneDrive.itemsChecked.toLocaleString()} checked`
          : undefined,
  };

  const fileDone = !fileIndex.indexing && (fileIndex.processed ?? 0) > 0;
  const filePct = fileIndex.indexing ? fileIndex.percent : fileDone ? 100 : 0;
  const fileArea: Area = {
    key: 'files',
    label: 'Files',
    pct: filePct,
    done: fileDone,
    active: fileIndex.indexing,
    status: statusText(fileDone, fileIndex.indexing, filePct),
    detail: fileIndex.total != null ? `${String(fileIndex.processed ?? 0)}/${String(fileIndex.total)}` : undefined,
  };

  return [emailArea, crmArea, oneDriveArea, fileArea];
}

export function FirmSetupScene() {
  const C = ONB_COPY.firm;
  const progress = useSetupProgress();
  const [retryingModels, setRetryingModels] = useState(false);
  const [showMoreExamples, setShowMoreExamples] = useState(false);
  const visibleQuestions = showMoreExamples ? ONB_EXAMPLE_QUESTIONS : ONB_EXAMPLE_QUESTIONS.slice(0, 4);

  // Client Map "building" callout. building is effectively always 0 from this
  // hook, so derive "in progress" from built < total.
  const cmTotal = progress?.clientMap.total ?? 0;
  const cmBuilt = progress?.clientMap.built ?? 0;
  const cmDone = cmTotal > 0 && cmBuilt === cmTotal;
  // Only show the animated "building" bar when there are maps actually being
  // built. With nothing queued (e.g. the "connect my own data" path before any
  // client is opened), an endless sweep would over-promise — so we show the
  // honest static note instead: maps build when you open each client.
  const cmBuilding = cmTotal > 0 && !cmDone;

  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-firm">
      <h1 className="text-3xl font-extrabold tracking-[-0.01em] text-[var(--kp-navy)] md:text-4xl">{C.headline}</h1>
      <p className="mt-3 max-w-[42ch] text-base text-[rgba(var(--kp-navy-rgb),0.70)]">{C.sub}</p>

      <div className="mt-8 w-full max-w-[760px] rounded-[24px] border border-[rgba(var(--kp-navy-rgb),0.08)] bg-white p-7 text-left shadow-[0_10px_40px_rgba(var(--kp-navy-rgb),0.06)]">
        {progress == null ? (
          <div className="text-sm text-[#5b6b80]" data-testid="firm-progress-idle">
            Getting ready. Your AI and data will start loading here.
          </div>
        ) : (
          <>
            <div className="text-xs font-bold tracking-[0.08em] text-[#5b6b80]">{C.yourAi}</div>
            <div className="mt-3">
              {(() => {
                const a = aiArea(progress);
                return (
                  <ProgressRow
                    label={a.label}
                    pct={a.pct}
                    done={a.done}
                    active={a.active}
                    failed={a.failed}
                    status={a.status}
                    retryLabel={retryingModels ? 'Retrying' : 'Retry'}
                    onRetry={
                      a.failed
                        ? () => {
                            setRetryingModels(true);
                            void retryFailedModelDownloads(progress).finally(() => {
                              setRetryingModels(false);
                            });
                          }
                        : undefined
                    }
                    testId={`firm-row-${a.key}`}
                  />
                );
              })()}
            </div>

            <div className="mt-7 text-xs font-bold tracking-[0.08em] text-[#5b6b80]">{C.importing}</div>
            <div className="mt-3 space-y-4">
              {importAreas(progress).map((a) => (
                <ProgressRow
                  key={a.key}
                  label={a.label}
                  pct={a.pct}
                  done={a.done}
                  active={a.active}
                  status={a.status}
                  detail={a.detail}
                  testId={`firm-row-${a.key}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Building your Client Maps */}
          <div className="mt-7 rounded-2xl border border-[#1fa971]/25 bg-[#1fa971]/[0.06] p-4" data-testid="firm-client-maps">
          <div className="text-sm font-bold text-[var(--kp-navy)]">{C.clientMapTitle}</div>
          <div className="text-xs text-[#5b6b80]">{C.clientMapSub}</div>
          {cmDone || cmBuilding ? (
            <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-[rgba(var(--kp-navy-rgb),0.10)]">
              {cmDone ? (
                <div className="h-full rounded-full bg-[#1fa971]" style={{ width: '100%' }} />
              ) : (
                <div className="kp-onbv2-indet" />
              )}
            </div>
          ) : (
            // Nothing queued yet — be honest rather than animate a sweep that
            // isn't backing any real work. This is the true behavior.
            <div className="mt-2 text-xs text-[#5b6b80]" data-testid="firm-client-maps-note">
              I build a Client Map for each client automatically the first time you open them.
            </div>
          )}
        </div>
      </div>

      {/* Things you can ask Lantern */}
      <div className="mt-8 w-full max-w-[760px]">
        <div className="text-sm font-bold text-[var(--kp-navy)]">{C.asksHeader}</div>
        <div className="kp-onbv2-scroll mt-3 flex max-h-28 flex-wrap justify-center gap-2 overflow-y-auto">
          {visibleQuestions.map((q) => (
            <span
              key={q}
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(var(--kp-navy-rgb),0.08)] bg-white px-3 py-1.5 text-xs text-[var(--kp-navy)] shadow-[0_4px_14px_rgba(var(--kp-navy-rgb),0.05)]"
            >
              <span className="font-bold text-[var(--kp-blue)]">?</span>
              {q}
            </span>
          ))}
        </div>
        {!showMoreExamples && ONB_EXAMPLE_QUESTIONS.length > 4 ? (
          <button
            type="button"
            data-testid="firm-more-examples"
            onClick={() => { setShowMoreExamples(true); }}
            className="mt-3 text-sm font-semibold text-[var(--kp-accent)] hover:underline"
          >
            {C.moreExamples}
          </button>
        ) : null}
      </div>
    </div>
  );
}
