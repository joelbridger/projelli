/**
 * ConnectScene — "2. Connect your practice".
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

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Monitor, EyeOff, ChevronDown, FileDown, Mail } from 'lucide-react';

import { MailConnect } from '@/platform/connectors/email/MailConnect';
import { MailGmailConnect } from '@/platform/connectors/email/MailGmailConnect';
import { MailImapConnect } from '@/platform/connectors/email/MailImapConnect';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';
import { WealthboxConnect } from '@/platform/connectors/crm/WealthboxConnect';

import { SecurityPill } from '../components/SecurityPill';
import { getOnboardingV2Copy, ONB_COMING_SOON_LOGOS } from '../copy';
import { InfoHelp } from '@/ui/InfoHelp';
import { ConnectorLogo, type ConnectorBrand } from './connectorLogos';

const PILL_ICONS = [Lock, Monitor, EyeOff] as const;

export function ConnectScene() {
  const { t } = useTranslation();
  const C = getOnboardingV2Copy(t).connect;
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
      <div className="mt-8 grid w-full max-w-[960px] grid-cols-1 gap-4 text-left md:grid-cols-2">
        <ConnectorCard
          testId="connect-m365"
          brand="m365"
          title={C.cards.m365.title}
          description={C.cards.m365.description}
        >
          <MailConnect />
        </ConnectorCard>
        <ConnectorCard
          testId="connect-gmail"
          brand="gmail"
          title={C.cards.gmail.title}
          description={C.cards.gmail.description}
        >
          <MailGmailConnect />
        </ConnectorCard>
        <ConnectorCard
          testId="connect-onedrive"
          brand="onedrive"
          title={C.cards.onedrive.title}
          description={C.cards.onedrive.description}
        >
          <OneDriveConnect />
        </ConnectorCard>
        <ConnectorCard
          testId="connect-wealthbox"
          brand="wealthbox"
          title={C.cards.wealthbox.title}
          description={C.cards.wealthbox.description}
        >
          <WealthboxConnect />
        </ConnectorCard>
      </div>

      {/* More email options (IMAP) */}
      <div className="mt-4 w-full max-w-[960px] text-left">
        <button
          type="button"
          onClick={() => { setMoreEmail((v) => !v); }}
          aria-expanded={moreEmail}
          data-testid="connect-more-email"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--kp-accent)] hover:underline"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${moreEmail ? 'rotate-180' : ''}`} aria-hidden="true" />
          {C.cards.imap.toggle}
        </button>
        {moreEmail ? (
          <div className="mt-3 max-w-[470px]">
            <div
              data-testid="connect-imap"
              className="rounded-lg border border-[var(--kp-divider)] bg-white p-4 text-left shadow-[var(--kp-shadow-1)]"
            >
              <div className="flex items-start gap-3 border-b border-[var(--kp-divider)] pb-4">
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] text-[var(--kp-text-dim)]">
                  <Mail className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[var(--kp-navy)]">{C.cards.imap.title}</div>
                  <div className="mt-1 text-xs leading-snug text-[var(--kp-text-dim)]">{C.cards.imap.description}</div>
                </div>
              </div>
              <div className="mt-4 min-w-0 [&>section]:!m-0 [&>section]:!border-0 [&>section]:!bg-transparent [&>section]:!p-0 [&>section]:!shadow-none [&_h3]:sr-only">
                <MailImapConnect />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Connector-access: honest "we read saved files" line. Advisor Prep Hero reads
          CRM notes, email, files, and saved reports from the places just
          connected — it is NOT an integration with those other tools. */}
      <div
        data-testid="connect-works-with-exports"
        className="mt-8 w-full max-w-[760px] rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-6 text-left"
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
      <div className="mt-8 w-full max-w-[760px] rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-5">
        <div className="text-xs font-bold tracking-[0.08em] text-[var(--kp-text-faint)]">{C.comingSoonLabel}</div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-7 gap-y-4 opacity-55 grayscale">
          {ONB_COMING_SOON_LOGOS.map((logo) => (
            <ComingSoonLogo key={logo.name} name={logo.name} file={logo.file} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectorCard({
  testId,
  brand,
  title,
  description,
  children,
}: {
  testId: string;
  brand: ConnectorBrand;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-[var(--kp-divider)] bg-white p-4 shadow-[var(--kp-shadow-1)]"
    >
      <div className="flex items-start gap-3 border-b border-[var(--kp-divider)] pb-4">
        <div className="flex h-11 w-24 flex-none items-center justify-center rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-2">
          <ConnectorLogo brand={brand} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-[var(--kp-navy)]">{title}</div>
          <div className="mt-1 text-xs leading-snug text-[var(--kp-text-dim)]">{description}</div>
        </div>
      </div>
      <div className="mt-4 min-w-0 [&>section]:!m-0 [&>section]:!border-0 [&>section]:!bg-transparent [&>section]:!p-0 [&>section]:!shadow-none [&_h3]:sr-only">
        {children}
      </div>
    </div>
  );
}

function ComingSoonLogo({ name, file }: { name: string; file: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[var(--kp-text-faint)]">{name}</span>
    );
  }
  return (
    <img
      src={`/onboarding/logos/${file}`}
      alt={name}
      title={name}
      className="h-6 w-auto object-contain"
      onError={() => { setFailed(true); }}
    />
  );
}
