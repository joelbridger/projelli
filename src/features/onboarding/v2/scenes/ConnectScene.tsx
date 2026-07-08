/* eslint-disable lantern-i18n/no-hardcoded-string */
/**
 * ConnectScene — "2. Securely connect your data".
 *
 * Wires the REAL data connectors. Rather than pixel-cloning the prototype's
 * three logo tiles with mock buttons, this reuses the actual, tested connector
 * components (MailConnect / MailGmailConnect / MailImapConnect /
 * WealthboxConnect / OneDriveConnect).
 * That matters: those components don't just authenticate, they kick off the
 * background sync that the "Setting up your firm" progress bars read from. A
 * cloned tile would connect but never import.
 *
 * The remaining prototype logos render as honest "coming soon" slots — never
 * fake connections.
 */

import { useState } from 'react';
import { Lock, Monitor, EyeOff, ChevronDown, FileDown } from 'lucide-react';

import { MailConnect } from '@/platform/connectors/email/MailConnect';
import { MailGmailConnect } from '@/platform/connectors/email/MailGmailConnect';
import { MailImapConnect } from '@/platform/connectors/email/MailImapConnect';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';
import { WealthboxConnect } from '@/platform/connectors/crm/WealthboxConnect';

import { SecurityPill } from '../components/SecurityPill';
import { ONB_COPY, ONB_COMING_SOON_LOGOS } from '../copy';
import { InfoHelp } from '@/ui/InfoHelp';

const PILL_ICONS = [Lock, Monitor, EyeOff] as const;

export function ConnectScene() {
  const C = ONB_COPY.connect;
  const [moreEmail, setMoreEmail] = useState(false);

  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-connect">
      <h1 className="text-3xl font-extrabold tracking-[-0.01em] text-[var(--kp-navy)] md:text-4xl">{C.headline}</h1>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {C.pills.map((label, i) => (
          <SecurityPill key={label} icon={PILL_ICONS[i] ?? Lock} label={label} />
        ))}
      </div>

      {/* Real connectors */}
      <div className="mt-8 grid w-full max-w-[920px] grid-cols-1 gap-4 text-left md:grid-cols-2">
        <div data-testid="connect-m365">
          <MailConnect />
        </div>
        <div data-testid="connect-wealthbox">
          <WealthboxConnect />
        </div>
        <div data-testid="connect-onedrive">
          <OneDriveConnect />
        </div>
      </div>

      {/* More email options (Gmail / IMAP) */}
      <div className="mt-4 w-full max-w-[920px] text-left">
        <button
          type="button"
          onClick={() => { setMoreEmail((v) => !v); }}
          aria-expanded={moreEmail}
          data-testid="connect-more-email"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--kp-accent)] hover:underline"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${moreEmail ? 'rotate-180' : ''}`} aria-hidden="true" />
          More email options (Gmail, IMAP)
        </button>
        {moreEmail ? (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div data-testid="connect-gmail">
              <MailGmailConnect />
            </div>
            <div data-testid="connect-imap">
              <MailImapConnect />
            </div>
          </div>
        ) : null}
      </div>

      {/* Connector-access: honest "we read your exports" line. Lantern reads
          the plan reports / meeting notes other tools export into the places
          just connected — it is NOT an integration with those tools. */}
      <div
        data-testid="connect-works-with-exports"
        className="mt-8 w-full max-w-[760px] rounded-[20px] border border-[rgba(var(--kp-navy-rgb),0.10)] bg-[var(--kp-bg-soft,#f1f5f9)] p-6 text-left"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white shadow-sm">
            <FileDown className="h-[18px] w-[18px] text-[var(--kp-accent)]" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--kp-navy)]">
              {C.worksWith.title}
              <InfoHelp content={`${C.worksWith.body} ${C.worksWith.disclaimer}`} />
            </div>
          </div>
        </div>
      </div>

      {/* Coming soon */}
      <div className="mt-8 w-full max-w-[760px] rounded-[20px] border border-[rgba(var(--kp-navy-rgb),0.08)] bg-white/80 p-6">
        <div className="text-xs font-bold tracking-[0.08em] text-[#5b6b80]">{C.comingSoonLabel}</div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-7 gap-y-4 opacity-60">
          {ONB_COMING_SOON_LOGOS.map((logo) => (
            <ComingSoonLogo key={logo.name} name={logo.name} file={logo.file} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ComingSoonLogo({ name, file }: { name: string; file: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="rounded-full bg-[#f5f7fb] px-3 py-1 text-xs font-medium text-[#8a93a3]">{name}</span>
    );
  }
  return (
    <img
      src={`/onboarding/logos/${file}`}
      alt={name}
      title={name}
      className="h-7 w-auto object-contain grayscale"
      onError={() => { setFailed(true); }}
    />
  );
}
