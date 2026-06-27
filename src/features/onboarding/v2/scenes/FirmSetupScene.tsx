/* eslint-disable keepance-i18n/no-hardcoded-string */
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

import { useSetupProgress } from '@/platform/hooks/useSetupProgress';
import type { SetupProgress } from '@/platform/utils/setup-progress-commands';

import { ProgressRow } from '../components/ProgressRow';
import { ONB_COPY, ONB_EXAMPLE_QUESTIONS } from '../copy';

interface Area {
  key: string;
  label: string;
  pct: number | null;
  done: boolean;
  active: boolean;
  status: string;
  detail?: string | undefined;
}

function statusText(done: boolean, active: boolean, pct: number | null): string {
  if (done) return 'Done';
  if (active) return pct != null ? `${String(pct)}%` : 'Working...';
  return 'Not started';
}

/** AI brain row (cloud key = instantly ready; local = live download percent). */
function aiArea(p: SetupProgress): Area {
  const { ai } = p;
  const done = ai.state === 'ready';
  const active = ai.state === 'downloading';
  const pct = done ? 100 : active ? (ai.percent ?? null) : 0;
  const label = ai.mode === 'cloud' ? 'Your AI provider is connected' : ONB_COPY.firm.aiLabel;
  return { key: 'ai', label, pct, done, active, status: statusText(done, active, pct) };
}

function importAreas(p: SetupProgress): Area[] {
  const { email, crm, fileIndex } = p;

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

  return [emailArea, crmArea, fileArea];
}

export function FirmSetupScene() {
  const C = ONB_COPY.firm;
  const progress = useSetupProgress();

  // Client Map "building" callout. building is effectively always 0 from this
  // hook, so derive "in progress" from built < total.
  const cmTotal = progress?.clientMap.total ?? 0;
  const cmBuilt = progress?.clientMap.built ?? 0;
  const cmDone = cmTotal > 0 && cmBuilt === cmTotal;

  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-firm">
      <h1 className="text-3xl font-extrabold tracking-[-0.01em] text-[#0a2540] md:text-4xl">{C.headline}</h1>
      <p className="mt-3 max-w-[42ch] text-base text-[#0a2540]/70">{C.sub}</p>

      <div className="mt-8 w-full max-w-[760px] rounded-[24px] border border-[#0a2540]/8 bg-white p-7 text-left shadow-[0_10px_40px_rgba(10,37,64,0.06)]">
        {progress == null ? (
          <div className="text-sm text-[#5b6b80]" data-testid="firm-progress-idle">
            Getting ready... your AI and data will start loading here.
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
                    status={a.status}
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
          <div className="text-sm font-bold text-[#0a2540]">{C.clientMapTitle}</div>
          <div className="text-xs text-[#5b6b80]">{C.clientMapSub}</div>
          <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-[#0a2540]/10">
            {cmDone ? (
              <div className="h-full rounded-full bg-[#1fa971]" style={{ width: '100%' }} />
            ) : (
              <div className="kp-onbv2-indet" />
            )}
          </div>
        </div>
      </div>

      {/* Things you can ask Keepance */}
      <div className="mt-8 w-full max-w-[760px]">
        <div className="text-sm font-bold text-[#0a2540]">{C.asksHeader}</div>
        <div className="kp-onbv2-scroll mt-3 flex max-h-28 flex-wrap justify-center gap-2 overflow-y-auto">
          {ONB_EXAMPLE_QUESTIONS.map((q) => (
            <span
              key={q}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#0a2540]/8 bg-white px-3 py-1.5 text-xs text-[#0a2540] shadow-[0_4px_14px_rgba(10,37,64,0.05)]"
            >
              <span className="font-bold text-[#5dc6ff]">?</span>
              {q}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
