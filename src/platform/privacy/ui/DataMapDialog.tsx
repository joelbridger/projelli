/**
 * DataMapDialog — "Where your data lives and who can see it".
 *
 * A plain-English, client-shareable map of exactly what happens to a user's
 * information in Lantern. It is reachable from Settings → Privacy and is built
 * to be PRINTED or saved to PDF so a lawyer can hand it to a worried client.
 *
 * ACCURACY IS THE WHOLE POINT. Every claim below mirrors the real architecture
 * and the canonical facts in `src/platform/privacy/egress.ts`. No marketing
 * language — this audience distrusts it. We are honest about the one asterisk:
 * when you use a cloud model, that provider sees your prompt.
 *
 * The copy is intentionally inlined here (not i18n-keyed line by line) because
 * it is a single long-form document and the legal precision of the English
 * wording is what matters; localisation of this document is a separate effort.
 */

/*
 * This screen is a single long-form legal-precision document whose exact English
 * wording is the product (it is printed and handed to a client). It is
 * intentionally NOT split into i18n keys; localising it is a separate, careful
 * effort. Disable the hardcoded-string rule for this file only.
 */
/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useRetentionPolicyStore, sanitizePolicy, retentionPolicyLabel } from '@/platform/privacy/retentionPolicyStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/ui/accordion';
import {
  Laptop,
  Cloud,
  Database,
  HardDrive,
  KeyRound,
  Mail,
  ScanText,
  Server,
  Printer,
  ChevronDown,
  X,
  BarChart2,
  Users,
} from 'lucide-react';
import { BRAND } from '@/config/brand';
import { brandText } from '@/config/brandText';

export interface DataMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MapRow {
  icon: typeof Laptop;
  /** Light-theme accent for the icon chip. */
  tone: string;
  title: string;
  body: string;
  /** Optional honest caveat shown in muted text. */
  caveat?: string;
}

export const DATA_MAP_ROWS: MapRow[] = [
  {
    icon: Laptop,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Your files and notes stay on your machine',
    body: `Your workspace is a normal folder on your own hard drive, in a location you chose. ${BRAND.name} opens and edits those files in place. There is no ${BRAND.name} cloud holding copies of your documents, and nothing is uploaded for sync.`,
  },
  {
    icon: KeyRound,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Your AI keys live in your operating system keychain',
    body: `When you add an API key for Anthropic, OpenAI, or Google, it is stored in your computer's own secure keychain (Keychain on macOS, Credential Manager on Windows, the Secret Service on Linux). ${BRAND.name} never holds your keys on a server and never charges you for the AI itself.`,
  },
  {
    icon: Cloud,
    tone: 'text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/40',
    title: 'When you use a cloud model, your prompt goes straight to that provider',
    body: `If your chat uses Anthropic, OpenAI, or Google, your message (and any file content you include) is sent directly from your machine to that provider's API using your own key. ${BRAND.name} is not a middleman in that request. It does not pass through, store, or see it.`,
    caveat: `The honest asterisk: that provider does receive your prompt. They commonly retain it for a limited window (often around 30 days for abuse monitoring; Google's window differs), and whether it is used to train their models is governed by your account settings in their console, not by ${BRAND.name}. Read your provider's data policy and set your training opt-out there.`,
  },
  {
    icon: Laptop,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'For your most sensitive work, use a local model',
    body: `Run a local model with Ollama and switch ${BRAND.name} to Local-only mode (Settings → AI → Confidentiality mode). In that mode the prompt and your files are processed by a model on your own machine, and outside connectors such as Wealthbox and email pause so nothing leaves this computer.`,
  },
  {
    icon: Mail,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Imported email is encrypted on your machine',
    body: 'If you import email, it is stored in a local, encrypted database on your device. It is searched and used for AI context the same way your files are: locally, under the same confidentiality rules.',
  },
  {
    icon: Users,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Your Wealthbox connection runs from your machine to Wealthbox',
    body: `When you connect Wealthbox, your API key is stored in your computer's own keychain, never on a ${BRAND.name} server. ${BRAND.name} reads your Wealthbox data by calling Wealthbox directly from your machine with that key, so those requests never pass through ${BRAND.possessive} servers and ${BRAND.name} never sees your CRM data. A sync imports the households and client records your Wealthbox login can see, and stores them in a local, encrypted database on your device, searched the same way your files are.`,
    caveat: `Reading is automatic; writing is not. ${BRAND.name} can write a note, task, or field update into Wealthbox, but only from a review card that lists exactly what will be sent, which you approve before anything goes out. Nothing is written back on its own. Disconnecting deletes the imported Wealthbox data from this device.`,
  },
  {
    icon: ScanText,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Scanned documents are read on your machine',
    body: `When a PDF in your workspace is a scan with no text layer, ${BRAND.name} reads it with an OCR engine that runs inside the app, on your computer. The page images and the recognized text never leave the device, and no cloud OCR service is ever used. Where the engine was less sure of a page, passages from it are labeled "low-confidence scan" in citations so you know to check the original.`,
  },
  {
    icon: Server,
    tone: 'text-slate-700 bg-slate-100 dark:text-slate-300 dark:bg-slate-800/60',
    title: `What ${BRAND.possessive} own servers see`,
    body: `The only automatic contact with ${BRAND.possessive} servers is a periodic license check. That request carries nothing about your documents, your prompts, or your clients. It sends only what is needed to confirm your purchase is active. If you opt into anonymous analytics in Settings, small lifecycle events (an anonymous install id plus an event name like 'app launched', with no file content and no prompts) are sent when you enable that option. If you use the bug-report form, the message you type in it is posted to ${BRAND.name} support. Neither analytics nor bug reports are on by default.`,
  },
  {
    icon: Server,
    tone: 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/40',
    title: `For firm Assured mode: AI requests go through a ${BRAND.name} relay`,
    body: `Firms that use Assured mode have a firm admin configure a managed provider key on the ${BRAND.name} backend. In that mode, AI requests from your machine go through the ${BRAND.name} relay, which attaches the firm's key server-side and forwards the request to your AI provider. ${BRAND.name} retains nothing from those requests (no prompt, no completion) under its Data Processing Agreement. The AI provider still receives your prompt under your firm's agreement with them. This path is visible in the egress indicator when it is active and applies only to firm members whose admin has enabled it. Solo users on direct BYOK are never routed this way.`,
    caveat: "Assured mode is a firm-tier feature. If you are a solo user, the relay is not in the picture for you at all.",
  },
  {
    icon: KeyRound,
    tone: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40",
    title: `${BRAND.name} can encrypt this workspace's files with AES-256`,
    body: `When you enable the vault, every document file is stored as ciphertext on disk (AES-256-GCM). ${BRAND.name} decrypts files transparently as you work, so your day-to-day experience is unchanged. A 24-word recovery phrase is generated once and never stored by ${BRAND.name}. If you lose that phrase and your device's keychain, ${BRAND.name} cannot recover your files. For firm workspaces, a firm admin holds an escrow copy and can recover the vault on your behalf.`,
    caveat: "File names and folder structure remain visible on disk regardless of vault status. Only the contents of individual files are encrypted. The recovery phrase is the sole backstop for solo users.",
  },
  {
    icon: BarChart2,
    tone: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40',
    title: 'Optional error reporting (opt-in, off by default)',
    body: `If you turn on Optional error reporting in Settings, ${BRAND.name} sends structured usage counts to help improve the product: which features you use, how many searches you run, which workflow template you ran, and whether you connected a provider. It never sends your content, file names, client names, prompts, or search queries. Only counts and internal ids. This is a separate opt-in from anonymous analytics, also off by default.`,
    caveat: `To confirm what is collected: Settings > Privacy > Optional error reporting lists every field sent. Help: ${BRAND.urls.supportUrl}.`,
  },
  {
    icon: HardDrive,
    tone: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40",
    title: "Document files rely on your disk encryption",
    body: "Your documents are normal files in your workspace folder. At-rest protection for those files comes from your operating system's full-disk encryption: BitLocker on Windows, FileVault on macOS, LUKS on Linux. With it on, your whole workspace is protected if the machine is lost or stolen.",
    caveat: "How to check: Windows: Settings > Privacy & security > Device encryption. macOS: System Settings > Privacy & Security > FileVault. Linux: your distribution's disk settings (LUKS).",
  },
  {
    icon: Database,
    tone: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
    title: 'What the search index itself stores',
    body: `To answer questions across your files, ${BRAND.name} keeps a local search index inside your workspace folder. The passage text in it is encrypted at rest, and so are the file paths, so the index on its own does not reveal which clients or projects you have files for. Two things in it stay readable on disk, on purpose: the workspace item label and the confidentiality tag on each passage, because search isolation has to filter on them before anything is searched.`,
    caveat: 'The index stores numeric summaries of your documents (not your actual words) that help the AI find relevant passages. These numeric summaries are kept on your device and are not sent anywhere on their own. One detail to be aware of: they sit on disk unencrypted, and this row exists so you know that.',
  },
];

function brandMapRow(row: MapRow): MapRow {
  const next: MapRow = {
    ...row,
    title: brandText(row.title),
    body: brandText(row.body),
  };
  if (row.caveat) next.caveat = brandText(row.caveat);
  return next;
}

export function DataMapDialog({ open, onOpenChange }: DataMapDialogProps) {
  const handlePrint = useCallback(() => {
    // Print just the document region into a tidy, client-ready page so the app
    // chrome / modal backdrop never lands in the printout. We use a hidden
    // iframe and DOM cloning (no document.write / innerHTML injection): the
    // map content is static and authored here, and cloning the live node keeps
    // it that way without any string-built HTML.
    const node = document.getElementById('lantern-data-map-printable');
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

    doc.title = brandText(`Where your data lives and who can see it (${BRAND.name})`);

    const style = doc.createElement('style');
    style.textContent = [
      'body { font: 14px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 720px; margin: 40px auto; padding: 0 24px; }',
      'h1 { font-size: 22px; margin: 0 0 4px; }',
      '.sub { color: #555; margin: 0 0 28px; }',
      '.row { margin: 0 0 22px; padding: 0 0 18px; border-bottom: 1px solid #e6e6e6; }',
      '.row:last-child { border-bottom: none; }',
      // Neutralize the collapse toggle button so the title prints as a heading.
      '.row button { all: unset; display: block; width: 100%; }',
      '.row h2 { font-size: 15px; margin: 0; }',
      '.row p { margin: 6px 0 0; }',
      // PRINT: reveal every collapsed section so the PDF captures the whole map.
      '[hidden] { display: block !important; }',
      'svg { display: none; }',
      '.caveat { color: #6b5300; background: #fff8e6; border: 1px solid #f0d98a; border-radius: 6px; padding: 8px 12px; margin-top: 8px; font-size: 13px; }',
      '.foot { margin-top: 28px; color: #777; font-size: 12px; }',
    ].join('\n');
    doc.head.appendChild(style);
    // Deep-clone the live, already-rendered map node into the print document.
    doc.body.appendChild(node.cloneNode(true));

    const cleanup = () => {
      // Defer removal so the print dialog has finished reading the document.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 500);
    };
    win.addEventListener('afterprint', cleanup, { once: true });

    // Give the cloned document a tick to lay out before printing.
    setTimeout(() => {
      win.focus();
      win.print();
      // Fallback cleanup in environments that never fire afterprint.
      setTimeout(cleanup, 1000);
    }, 100);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="data-map-dialog"
        className="max-w-2xl w-[92vw] h-[85vh] max-h-[820px] p-0 flex flex-col overflow-hidden [&>button]:hidden"
      >
        <DialogTitle className="sr-only">
          Where your data lives and who can see it
        </DialogTitle>
        <DialogDescription className="sr-only">
          A plain-English map of what stays on your machine and what is sent to your AI provider.
        </DialogDescription>

        {/* Header */}
        <div className="shrink-0 border-b px-6 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">
              Where your data lives and who can see it
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Plain-English, and printable so you can show a client.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              data-testid="data-map-print"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                onOpenChange(false);
              }}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body — this region is what gets printed. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <DataMapContent printableId="lantern-data-map-printable" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * DataMapContent — the plain-English data-map body, extracted so it can be
 * reused verbatim outside the dialog (e.g. as a step in first-run onboarding)
 * without duplicating the legally-precise copy. The wording lives in exactly
 * one place: `DATA_MAP_ROWS` and the surrounding prose here.
 *
 * variant="expanded" (default) — all sections fully visible, no collapse
 * interaction. Used by DataMapDialog (the Settings trust document) so every
 * claim is readable in place and captured when the user prints or saves a PDF.
 *
 * variant="accordion" — collapsed by default, single-open. Used by the
 * first-run onboarding wizard so the list is scannable at any window height
 * and the continue button stays in the viewport.
 */
export function DataMapContent({
  printableId,
  variant = 'expanded',
}: {
  printableId?: string;
  variant?: 'accordion' | 'expanded';
}) {
  // Collapsible single-open state for the dialog (expanded) variant. First row
  // open by default; -1 means all collapsed. Bodies stay mounted (hidden) so the
  // print/PDF clone still captures every section.
  const [openRow, setOpenRow] = useState<number>(0);
  const { t } = useTranslation();
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath);
  const rawPolicy = useRetentionPolicyStore((s) => (workspaceRoot ? s.policies[workspaceRoot] : undefined));
  const policy = sanitizePolicy(rawPolicy);
  const lastSweep = useRetentionPolicyStore((s) => (workspaceRoot ? s.lastSweep[workspaceRoot] : undefined));
  const [attestationPath, setAttestationPath] = useState<string | null>(null);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  const rows = DATA_MAP_ROWS.map(brandMapRow);
  return (
    <div id={printableId} data-testid="data-map-content">
      <h1 className="text-lg font-semibold mb-1">
        Where your data lives and who can see it
      </h1>
      <p className="sub text-sm text-muted-foreground mb-4">
        How {BRAND.name} handles your information, in plain language. The short
        version: your work stays on your computer, your AI requests go straight
        to the provider you chose (not through us), and you can run entirely on
        your own machine when you need to.
      </p>

      {variant === 'accordion' ? (
        // Open the first row ("Your files and notes stay on your machine") by
        // default so the attorney lands on a full, readable plain-English
        // section instead of an all-collapsed header scan. Single-open model is
        // preserved; the rest stay collapsed for a viewport-friendly list.
        <Accordion className="space-y-0" defaultValue="0">
          {rows.map((row, i) => {
            const Icon = row.icon;
            return (
              <AccordionItem
                key={i}
                value={String(i)}
                data-testid="data-map-section"
              >
                <AccordionTrigger
                  data-testid="data-map-section-trigger"
                  className="gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center ${row.tone}`}
                      aria-hidden
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-left text-sm font-semibold">{row.title}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pl-10">
                  <p className="text-sm text-muted-foreground">{row.body}</p>
                  {row.caveat && (
                    <p className="caveat mt-2 text-xs rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                      {row.caveat}
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : (
        // Collapsible, single-open. PRINT: the `.row` class + `.row h2` / `.row p`
        // are required by handlePrint's CSS. Bodies are kept mounted (hidden when
        // collapsed) and handlePrint force-shows [hidden], so the PDF still
        // captures every section. Do not unmount collapsed bodies.
        <div className="space-y-0">
          {rows.map((row, i) => {
            const Icon = row.icon;
            const isOpen = openRow === i;
            return (
              <div
                key={i}
                data-testid="data-map-section"
                className="row border-b border-border/60 last:border-b-0 py-1"
              >
                <button
                  type="button"
                  data-testid="data-map-section-trigger"
                  aria-expanded={isOpen}
                  onClick={() => { setOpenRow(isOpen ? -1 : i); }}
                  className="w-full flex items-center gap-3 min-w-0 py-2.5 text-left"
                >
                  <div
                    className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center ${row.tone}`}
                    aria-hidden
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  {/* PRINT: must be <h2> so `.row h2` in handlePrint CSS applies. */}
                  <h2 className="text-sm font-semibold m-0 flex-1">{row.title}</h2>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {/* PRINT: kept mounted (hidden when collapsed); handlePrint reveals it. */}
                <div hidden={!isOpen} className="pl-10 pb-2">
                  {/* PRINT: must be <p> so `.row p` in handlePrint CSS applies. */}
                  <p className="text-sm text-muted-foreground m-0">{row.body}</p>
                  {row.caveat && (
                    <p className="caveat mt-2 text-xs rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                      {row.caveat}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wave 4 Track D — live retention policy state + one-click attestation
          export. Bespoke JSX (not part of the static DATA_MAP_ROWS array) since
          it reads live store state; only shown in the expanded (Settings)
          variant, never the onboarding accordion. Keeps the same `.row` / `h2`
          / `p` structure as the static rows so handlePrint's CSS includes it. */}
      {variant === 'expanded' && workspaceRoot && (
        <div className="row" data-testid="data-map-retention">
          <h2 className="text-sm font-semibold m-0">{t('privacy.retention.datamap-title')}</h2>
          <p className="text-sm text-muted-foreground m-0">{retentionPolicyLabel(policy, t)}</p>
          <p className="text-sm text-muted-foreground m-0">
            {lastSweep
              ? t('privacy.retention.last-sweep', { when: new Date(lastSweep.sweptAt).toLocaleString(), count: lastSweep.deletedCount })
              : t('privacy.retention.never-swept')}
            {lastSweep && lastSweep.errors.length > 0 && ` ${t('privacy.retention.sweep-errors', { count: lastSweep.errors.length })}`}
          </p>
          <Button
            size="sm"
            variant="outline"
            data-testid="attestation-export"
            onClick={() => {
              setAttestationError(null);
              void import('@/platform/privacy/attestation')
                .then(({ exportAttestationDocx }) => exportAttestationDocx(workspaceRoot))
                .then((path) => { setAttestationPath(path); })
                .catch((e: unknown) => { setAttestationError(e instanceof Error ? e.message : String(e)); });
            }}
          >
            {t('privacy.retention.attestation-button')}
          </Button>
          {attestationPath && (
            <p className="text-xs text-muted-foreground m-0">{t('privacy.retention.attestation-done', { path: attestationPath })}</p>
          )}
          {attestationError && (
            <p className="text-xs text-destructive m-0">{attestationError}</p>
          )}
        </div>
      )}

      {IS_DEMO ? (
        <p className="foot mt-4 text-xs text-muted-foreground">
          You are using the online browser demo. The demo routes AI messages
          through a shared {BRAND.name} relay and should never be used with
          confidential or client information. Download the desktop app for the
          full private, local-first experience described above.
        </p>
      ) : (
        <p className="foot mt-4 text-xs text-muted-foreground">
          You are using the {BRAND.name} desktop app. Everything described above
          applies to you. {BRAND.name} is a tool you control, not a custodian of
          your data. You decide what is sent and to whom.
        </p>
      )}
    </div>
  );
}

export default DataMapDialog;
