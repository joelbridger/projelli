/**
 * VG-4a — shown when the user asks for PDF export and LibreOffice is not
 * installed. Explains exactly what to install and why, with a copyable
 * link. No silent failure path remains.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Copy, Check, X } from 'lucide-react';

const DOWNLOAD_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

export function LibreOfficeHelpNotice({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div
      data-testid="libreoffice-help-notice"
      role="alert"
      className="mx-3 my-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{t('media.docx-editor.pdf-needs-libreoffice-title')}</p>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onDismiss} aria-label={t('common.actions.dismiss', 'Dismiss')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="mt-1">{t('media.docx-editor.pdf-needs-libreoffice-body')}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded bg-white px-2 py-1 text-xs border border-amber-200">{DOWNLOAD_URL}</code>
        <Button
          data-testid="libreoffice-copy-link"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(DOWNLOAD_URL).then(() => setCopied(true));
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('media.docx-editor.pdf-libreoffice-copied') : t('media.docx-editor.pdf-libreoffice-copy')}
        </Button>
      </div>
    </div>
  );
}
