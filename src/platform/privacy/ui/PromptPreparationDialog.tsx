import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useTranslation } from 'react-i18next';
import type { SecretFinding } from '../promptPreparation';

export function PromptPreparationDialog({ open, findings, onSendRedactedCopy, onCancel }: {
  open: boolean;
  findings: SecretFinding[];
  onSendRedactedCopy: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const privateLinks = findings.reduce((total, finding) => total + finding.count, 0);
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent className="bg-white text-slate-950">
        <DialogHeader>
          <DialogTitle>{t('privacy.prompt-preparation.title')}</DialogTitle>
          <DialogDescription>
            {t('privacy.prompt-preparation.description', { count: privateLinks })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSendRedactedCopy}>{t('privacy.prompt-preparation.send-redacted-copy')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
