/**
 * FirmSecurityPack — one-click "security overview" an advisor can hand to
 * their firm's CCO or compliance officer to get Lantern approved.
 *
 * ACCURACY IS THE WHOLE POINT. Every claim mirrors the real architecture and
 * the canonical facts in `src/platform/privacy/egress.ts`. No marketing
 * language — this audience distrusts it. Where something is not finished or
 * not yet certified, we say so plainly.
 *
 * Print pattern reused verbatim from DataMapDialog (same hidden-iframe approach,
 * same CSS conventions: `.row`, `.row h2`, `.row p`, `[hidden]` force-show).
 *
 * Per-mode egress facts are imported directly from `src/platform/privacy/egress.ts`
 * (canonical). Never hand-retyped.
 */

/*
 * This is a single long-form trust document whose exact English wording is the
 * product (it is printed and handed to a firm's CCO / compliance officer). Disable the
 * hardcoded-string rule for this file only.
 */
/* eslint-disable lantern-i18n/no-hardcoded-string */

import { useCallback, useState } from 'react';
import {
  Laptop,
  Server,
  Shield,
  KeyRound,
  Users,
  BadgeCheck,
  HelpCircle,
  Printer,
  ChevronDown,
  FileText,
  Link,
  Download,
} from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { DataMapContent } from '@/platform/privacy/ui/DataMapDialog';
import { resolveEgress } from '@/platform/privacy/egress';
import { BRAND } from '@/config/brand';
import {
  exportPrivacyCenterOverviewDocx,
  exportPrivacyCenterOverviewPdf,
} from '@/features/privacy/privacyCenterOverviewExport';

/* ---------------------------------------------------------------------------
 * Per-mode egress descriptions — derived from egress.ts, not hand-typed.
 * We call resolveEgress() for each canonical mode and pull the honest label
 * and note. This means the displayed facts update automatically when egress.ts
 * changes.
 * ---------------------------------------------------------------------------*/

const LOCAL_ONLY_EGRESS = resolveEgress({
  provider: 'ollama',
  mode: 'local-only',
});
const DIRECT_EGRESS = resolveEgress({ provider: 'anthropic', mode: 'direct' });
const ASSURED_EGRESS = resolveEgress({
  provider: 'anthropic',
  mode: 'assured',
  assuredAvailable: true,
});

/* ---------------------------------------------------------------------------
 * Static section content
 * ---------------------------------------------------------------------------*/

interface Section {
  id: string;
  icon: typeof Laptop;
  tone: string;
  heading: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'what-lantern-is',
    icon: Laptop,
    tone: 'text-emerald-700 bg-emerald-50',
    heading: `What ${BRAND.name} is`,
    body: (
      <p>
        {`
        ${BRAND.name} is a private intelligence layer for your practice. It runs as a
        desktop app on your own computer. Documents, email, and client records
        stay in local files you control. ${BRAND.name} answers questions across all of
        it and shows a citation you can open and check for every answer.
      `}</p>
    ),
  },
  {
    id: 'where-data-lives',
    icon: Server,
    tone: 'text-sky-700 bg-sky-50',
    heading: 'Where data lives',
    body: (
      <>
        <p>
          {`
          Your files stay on your own computer. ${BRAND.name} has no content server.
          We never receive, store, or can read your client records.
        `}</p>
        <p style={{ marginTop: '0.75rem', fontWeight: 600 }}>
          Data map (full detail below):
        </p>
      </>
    ),
  },
  {
    id: 'intake-secure-links',
    icon: Link,
    tone: 'text-cyan-700 bg-cyan-50',
    heading: 'Intake / secure client links',
    body: (
      <div>
        <p>
          {`
          ${BRAND.name} Intake lets an advisor send a secure checklist link to a
          client or household. On the honest client page, each submitted answer
          and document is encrypted in the browser before upload to a key held
          in the advisor&apos;s operating system keychain. The relay is a
          mailbox for encrypted submissions, not an archive.
        `}</p>
        <p style={{ marginTop: '0.75rem' }}>
          <strong>The relay can see:</strong> the intake ID, the creating seat
          or organization identity, lifecycle and submission timestamps, opaque
          item IDs, ciphertext sizes and chunk counts, the checklist version, a
          token hash, and ordinary connection details such as IP address and
          user agent.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          <strong>The relay cannot see:</strong> It cannot see a client&apos;s
          name, email address or phone number in v1, checklist labels, answers
          including Social Security numbers, file names or file contents. It
          does not receive the private key needed to decrypt a submission.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          The secure-link claim depends on page integrity. A compromised hosted
          page could read information typed during that session before
          encryption. The design therefore requires a self-contained page with
          no third-party code, analytics, or CDN, plus restrictive browser
          rules, published build hashes, and a deploy-time integrity check.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          Email fallback is a separate channel with the confidentiality of the
          firm&apos;s email system. It is not end-to-end encrypted, and
          email-sourced items must remain clearly labeled as such.
        </p>
        <div style={{ marginTop: '0.75rem' }}>
          <strong>Reviewer checklist before enabling Intake</strong>
          <ul style={{ marginTop: '0.35rem', paddingLeft: '1.25rem' }}>
            <li>
              Verify the deployed page has no third-party code, analytics, or
              CDN.
            </li>
            <li>
              Verify the published build hash and deploy-time integrity check.
            </li>
            <li>
              Verify access-log retention and rate limits match this metadata
              list.
            </li>
            <li>
              Verify the relay deletes ciphertext only after local durable
              storage.
            </li>
            <li>
              Confirm email fallback is not end-to-end encrypted in every
              message.
            </li>
            <li>
              Set the firm&apos;s retention rules before collecting restricted
              information.
            </li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: 'privacy-modes',
    icon: Shield,
    tone: 'text-indigo-700 bg-indigo-50',
    heading: 'The three privacy modes and exactly what leaves the machine',
    body: (
      <div>
        <div style={{ marginBottom: '0.75rem' }}>
          <strong>Local-only:</strong> {LOCAL_ONLY_EGRESS.note}{' '}
          <span style={{ color: '#555' }}>
            (
            {LOCAL_ONLY_EGRESS.dataLeaves
              ? 'data may leave device'
              : 'nothing leaves the device'}
            )
          </span>
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <strong>Direct (bring your own key):</strong> {DIRECT_EGRESS.note}{' '}
          <span style={{ color: '#555' }}>
            {`
            (data leaves to your chosen AI provider, not to ${BRAND.name})
          `}</span>
        </div>
        <div>
          <strong>Assured (firm option):</strong> {ASSURED_EGRESS.note}{' '}
          <span style={{ color: '#555' }}>
            (data passes through firm&apos;s zero-retention proxy under a DPA)
          </span>
          <span
            style={{
              display: 'block',
              marginTop: '0.35rem',
              color: '#b45309',
              fontStyle: 'italic',
            }}
          >
            Note: the Assured zero-retention proxy is the firm-tier architecture
            we have designed and de-risked. Its independent audit is planned and
            not yet complete, and it is not yet represented as a generally
            available production service. We encourage you to inspect the design
            directly rather than rely on an asserted guarantee. The DPA template
            describes this honestly in Section 6.4.
          </span>
        </div>
      </div>
    ),
  },
  {
    id: 'keys-and-accounts',
    icon: KeyRound,
    tone: 'text-emerald-700 bg-emerald-50',
    heading: 'Keys and accounts',
    body: (
      <p>
        {`
        ${BRAND.name} never holds AI keys and never charges for AI usage. Solo use
        needs no account at all. Firm use adds single sign-on, seats, and shared
        matters.
      `}</p>
    ),
  },
  {
    id: 'firm-collaboration',
    icon: Users,
    tone: 'text-violet-700 bg-violet-50',
    heading: 'Firm collaboration security',
    body: (
      <p>
        Your client data is encrypted on your device; the relay stores only
        ciphertext and opaque handles and never sees client names or documents.
        Information barriers are enforced by withholding keys, not by hiding
        things in the interface. Single sign-on is supported through your
        identity provider.
      </p>
    ),
  },
  {
    id: 'assurance-status',
    icon: BadgeCheck,
    tone: 'text-amber-700 bg-amber-50',
    heading: 'Current assurance status',
    body: (
      <div>
        <p>
          <strong>SOC 2:</strong> {` ${BRAND.name} is not SOC 2 certified. A readiness
          and gap-analysis assessment is complete (see`}{' '}
          <code>docs/trust/soc2-readiness.md</code>); a formal audit by an
          independent CPA firm has not yet been completed. A SOC 2 Type II
          report requires an independent CPA auditor and an observation period
          (typically 3 to 6 months) that has not yet run. We will state this
          plainly in any firm conversation. If your firm requires SOC 2 as a
          gate, we are happy to discuss the readiness timeline.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          <strong>DPA:</strong> A Data Processing Agreement is available on
          request. A template is on file (see{' '}
          <code>docs/legal/DPA-template.md</code>) and requires review by
          qualified counsel before execution. It accurately describes the
          local-first architecture and covers all three operating modes. The
          Assured proxy described in the DPA is in development and not yet
          generally available; the contractual terms for that path should be
          aligned with what the deployed service and its independent audit can
          actually support before execution.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          <strong>Firm installation:</strong> {` ${BRAND.name} runs as a desktop
          application on your hardware. Your IT team deploys and updates it
          through your normal software distribution process. No configuration of
          ${BRAND.name}&apos;s infrastructure is required for a solo or small-firm
          install.
        `}</p>
      </div>
    ),
  },
  {
    id: 'what-to-ask',
    icon: HelpCircle,
    tone: 'text-slate-700 bg-slate-100',
    heading: 'What to ask us',
    body: (
      <div>
        <p>
          Questions for your security or ethics reviewer to send to{' '}
          <a href={`mailto:${BRAND.urls.developersEmail}`}>
            {BRAND.urls.developersEmail}
          </a>
          . We will answer in writing.
        </p>
        <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
          <li>Where exactly is my data stored, and who has access?</li>
          <li>What leaves the device when I use a cloud AI model?</li>
          <li>How do information barriers work across shared clients?</li>
          <li>What is the status of your SOC 2 examination?</li>
          <li>Can I see the DPA before we sign?</li>
          <li>
            How do I verify the claims in this document against the source code?
          </li>
        </ul>
      </div>
    ),
  },
];

/* ---------------------------------------------------------------------------
 * Print mechanism (reused verbatim from DataMapDialog)
 * ---------------------------------------------------------------------------*/

function usePrint(printableId: string) {
  return useCallback(() => {
    const node = document.getElementById(printableId);
    if (!node) {
      window.print();
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    doc.title = `${BRAND.name} security overview for CCO / compliance officer`;

    const style = doc.createElement('style');
    style.textContent = [
      'body { font: 14px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 720px; margin: 40px auto; padding: 0 24px; }',
      'h1 { font-size: 22px; margin: 0 0 4px; }',
      '.sub { color: #555; margin: 0 0 28px; }',
      '.row { margin: 0 0 22px; padding: 0 0 18px; border-bottom: 1px solid #e6e6e6; }',
      '.row:last-child { border-bottom: none; }',
      '.row button { all: unset; display: block; width: 100%; }',
      '.row h2 { font-size: 15px; margin: 0; }',
      '.row p { margin: 6px 0 0; }',
      // PRINT: reveal every collapsed section so the PDF captures everything.
      '[hidden] { display: block !important; }',
      'svg { display: none; }',
      'ul { margin: 6px 0 0 0; padding-left: 20px; }',
      'li { margin: 2px 0; }',
      'a { color: #1a1a1a; text-decoration: none; }',
      'code { font-size: 12px; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }',
      '.foot { margin-top: 28px; color: #777; font-size: 12px; }',
    ].join('\n');
    doc.head.appendChild(style);
    doc.body.appendChild(node.cloneNode(true));

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 500);
    };
    win.addEventListener('afterprint', cleanup, { once: true });

    setTimeout(() => {
      win.focus();
      win.print();
      setTimeout(cleanup, 1000);
    }, 100);
  }, [printableId]);
}

/* ---------------------------------------------------------------------------
 * FirmSecurityPackContent — the printable body, extracted so tests can render
 * it directly without the page chrome.
 * ---------------------------------------------------------------------------*/

const PRINTABLE_ID = 'lantern-firm-security-pack-printable';

export function FirmSecurityPackContent() {
  const [openSection, setOpenSection] = useState<string | null>(
    SECTIONS[0]?.id ?? null
  );

  return (
    <div id={PRINTABLE_ID} data-testid="firm-security-pack-content">
      <h1 className="text-lg font-semibold mb-1">
        {`
        ${BRAND.name} security overview for your firm&apos;s CCO / compliance officer
      `}</h1>
      <p className="sub text-sm text-muted-foreground mb-4">
        {`
        This is a plain-English summary of how ${BRAND.name} handles your client data,
        written so your CCO or compliance officer can evaluate it quickly. Every
        claim here matches how the software actually works. If something
        isn&apos;t finished yet, I say so.
      `}</p>

      <div className="space-y-0" data-testid="firm-security-pack-sections">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isOpen = openSection === section.id;
          return (
            <div
              key={section.id}
              data-testid={`firm-security-pack-section-${section.id}`}
              className="row border-b border-border/60 last:border-b-0 py-1"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                  setOpenSection(isOpen ? null : section.id);
                }}
                className="w-full flex items-center gap-3 min-w-0 py-2.5 text-left"
              >
                <div
                  className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center ${section.tone}`}
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                {/* PRINT: must be <h2> so `.row h2` in print CSS applies. */}
                <h2 className="text-sm font-semibold m-0 flex-1">
                  {section.heading}
                </h2>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {/* PRINT: kept mounted (hidden when collapsed); print CSS reveals it. */}
              <div
                hidden={!isOpen}
                className="pl-10 pb-2 text-sm text-muted-foreground"
              >
                {section.id === 'where-data-lives' ? (
                  <>
                    {section.body}
                    {/* Embed the full DataMapContent for the "Where data lives" section */}
                    <div className="mt-3 border border-border/60 rounded-md p-3 bg-background/50">
                      <DataMapContent variant="expanded" />
                    </div>
                  </>
                ) : (
                  section.body
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="foot mt-4 text-xs text-muted-foreground">
        {`
        This document was generated from the ${BRAND.name} desktop app. All claims are
        verifiable against the source code referenced in`}{' '}
        <code>docs/trust/security-overview.md</code>. For the full data
        processing contract, see <code>docs/legal/DPA-template.md</code>. For
        Intake secure-link detail and the full reviewer checklist, see{' '}
        <code>docs/trust/it-pack/INTAKE-IT-PACK.md</code>. For SOC 2 status, see{' '}
        <code>docs/trust/soc2-readiness.md</code>{`. ${BRAND.name} is not SOC 2
        certified as of this document.
      `}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * FirmSecurityPack — full-page surface with header and print button.
 * Available on all installs; not gated behind firm status.
 * ---------------------------------------------------------------------------*/

export function FirmSecurityPack() {
  const handlePrint = usePrint(PRINTABLE_ID);

  const handleOverviewDocxExport = useCallback(() => {
    void exportPrivacyCenterOverviewDocx().catch((error: unknown) => {
      console.error('Failed to export firm security overview as Word:', error);
    });
  }, []);

  const handleOverviewPdfExport = useCallback(() => {
    void exportPrivacyCenterOverviewPdf().catch((error: unknown) => {
      console.error('Failed to export firm security overview as PDF:', error);
    });
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <SurfaceHeader
          Icon={FileText}
          title="Security overview for your firm"
          actions={
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Button
                variant="secondary"
                size="sm"
                data-testid="firm-security-pack-export-docx"
                onClick={handleOverviewDocxExport}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export Word
              </Button>
              <Button
                variant="secondary"
                size="sm"
                data-testid="firm-security-pack-export-pdf"
                onClick={handleOverviewPdfExport}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export PDF
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="firm-security-pack-print-button"
                onClick={handlePrint}
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                Print / Save PDF
              </Button>
            </div>
          }
        />
      </div>

      {/* Scrollable body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--kp-space-md) var(--kp-gutter)',
        }}
      >
        <FirmSecurityPackContent />
      </div>
    </div>
  );
}

export default FirmSecurityPack;
