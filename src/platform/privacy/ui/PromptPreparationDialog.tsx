import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import type { SecretFinding } from '../promptPreparation';

export function PromptPreparationDialog({ open, findings, onSendRedactedCopy, onCancel }: {
  open: boolean;
  findings: SecretFinding[];
  onSendRedactedCopy: () => void;
  onCancel: () => void;
}) {
  const privateLinks = findings.reduce((total, finding) => total + finding.count, 0);
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent className="bg-white text-slate-950">
        <DialogHeader>
          <DialogTitle>Review private links</DialogTitle>
          <DialogDescription>
            I found {privateLinks} private access link{privateLinks === 1 ? '' : 's'} in the material for this AI request. I made a safe copy with the private parts hidden. Send that safe copy?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSendRedactedCopy}>Send redacted copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
