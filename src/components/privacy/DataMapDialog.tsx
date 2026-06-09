/**
 * DataMapDialog — "Where your data lives and who can see it".
 *
 * A plain-English, client-shareable map of exactly what happens to a user's
 * information in Keepance. It is reachable from Settings → Privacy and is built
 * to be PRINTED or saved to PDF so a lawyer can hand it to a worried client.
 *
 * ACCURACY IS THE WHOLE POINT. Every claim below mirrors the real architecture
 * and the canonical facts in `src/modules/privacy/egress.ts`. No marketing
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
/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Laptop,
  Cloud,
  KeyRound,
  Mail,
  Server,
  Printer,
  X,
} from 'lucide-react';

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

const ROWS: MapRow[] = [
  {
    icon: Laptop,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Your files and notes stay on your machine',
    body: 'Your workspace is a normal folder on your own hard drive, in a location you chose. Keepance opens and edits those files in place. There is no Keepance cloud holding copies of your documents, and nothing is uploaded for sync.',
  },
  {
    icon: KeyRound,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Your AI keys live in your operating system keychain',
    body: 'When you add an API key for Anthropic, OpenAI, or Google, it is stored in your computer’s own secure keychain (Keychain on macOS, Credential Manager on Windows, the Secret Service on Linux). Keepance never holds your keys on a server and never charges you for the AI itself.',
  },
  {
    icon: Cloud,
    tone: 'text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/40',
    title: 'When you use a cloud model, your prompt goes straight to that provider',
    body: 'If your chat uses Anthropic, OpenAI, or Google, your message (and any file content you include) is sent directly from your machine to that provider’s API using your own key. Keepance is not a middleman in that request. It does not pass through, store, or see it.',
    caveat: 'The honest asterisk: that provider does receive your prompt. They commonly retain it for a limited window (often around 30 days for abuse monitoring; Google’s window differs), and whether it is used to train their models is governed by your account settings in their console, not by Keepance. Read your provider’s data policy and set your training opt-out there.',
  },
  {
    icon: Laptop,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'For nothing-leaves work, use a local model',
    body: 'Run a local model with Ollama and switch Keepance to Local-only mode (Settings → AI → Confidentiality mode). In that mode the prompt and your files are processed by a model on your own machine and nothing is sent over the network at all: not to a provider, not to Keepance.',
  },
  {
    icon: Mail,
    tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    title: 'Imported email is encrypted on your machine',
    body: 'If you import email, it is stored in a local, encrypted database on your device. It is searched and used for AI context the same way your files are: locally, under the same confidentiality rules.',
  },
  {
    icon: Server,
    tone: 'text-slate-700 bg-slate-100 dark:text-slate-300 dark:bg-slate-800/60',
    title: 'The only thing Keepance’s own servers ever see is a licence check',
    body: 'Keepance contacts its own server for exactly one reason: to validate your licence (a periodic check that your purchase is active). That request does not contain your documents, your prompts, or your client information, only what is needed to confirm the licence.',
  },
];

export function DataMapDialog({ open, onOpenChange }: DataMapDialogProps) {
  const handlePrint = useCallback(() => {
    // Print just the document region into a tidy, client-ready page so the app
    // chrome / modal backdrop never lands in the printout. We use a hidden
    // iframe and DOM cloning (no document.write / innerHTML injection): the
    // map content is static and authored here, and cloning the live node keeps
    // it that way without any string-built HTML.
    const node = document.getElementById('keepance-data-map-printable');
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

    doc.title = 'Where your data lives and who can see it (Keepance)';

    const style = doc.createElement('style');
    style.textContent = [
      'body { font: 14px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 720px; margin: 40px auto; padding: 0 24px; }',
      'h1 { font-size: 22px; margin: 0 0 4px; }',
      '.sub { color: #555; margin: 0 0 28px; }',
      '.row { margin: 0 0 22px; padding: 0 0 18px; border-bottom: 1px solid #e6e6e6; display: flex; gap: 12px; }',
      '.row:last-child { border-bottom: none; }',
      '.row h2 { font-size: 15px; margin: 0 0 6px; }',
      '.row p { margin: 0; }',
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
          <div id="keepance-data-map-printable">
            <h1 className="text-lg font-semibold mb-1">
              Where your data lives and who can see it
            </h1>
            <p className="sub text-sm text-muted-foreground mb-6">
              How Keepance handles your information, in plain language. The short
              version: your work stays on your computer, your AI requests go
              straight to the provider you chose (not through us), and you can run
              entirely on your own machine when you need to.
            </p>

            <div className="space-y-0">
              {ROWS.map((row, i) => {
                const Icon = row.icon;
                return (
                  <div
                    key={i}
                    data-testid={`data-map-row-${String(i)}`}
                    className="row flex gap-3 py-4 border-b border-border/60 last:border-b-0"
                  >
                    <div
                      className={`shrink-0 h-8 w-8 rounded-md flex items-center justify-center ${row.tone}`}
                      aria-hidden
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold mb-1">{row.title}</h2>
                      <p className="text-sm text-muted-foreground">{row.body}</p>
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

            <p className="foot mt-6 text-xs text-muted-foreground">
              This describes the Keepance desktop app. The online browser demo is
              different: it can route messages through a shared Keepance relay, so
              the demo should never be used with confidential or client
              information. Keepance is a tool you control, not a custodian of your
              data. You decide what is sent and to whom.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DataMapDialog;
