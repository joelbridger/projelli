/**
 * Task 10b — "File as meeting note…" client picker. Opened from a dictation
 * voice note's tab context menu (TabBar.tsx); on confirm, files the note's
 * text into the chosen client's Meetings/ via `fileDictationAsMeeting`.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { useMatters } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { fileDictationAsMeeting } from './meetingStore';

/** Strips the `---\n...\n---\n` frontmatter block `buildVoiceNoteBody` writes,
 *  leaving just the dictated text. */
export function stripVoiceNoteFrontmatter(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
  return (m?.[1] !== undefined ? m[1] : content).trim();
}

export interface FileAsMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteContent: string;
  onFiled: (matterId: string) => void;
}

export function FileAsMeetingDialog({ open, onOpenChange, noteContent, onFiled }: FileAsMeetingDialogProps) {
  const { t } = useTranslation();
  const matters = useMatters();
  const [search, setSearch] = useState('');
  const [filing, setFiling] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return matters;
    return matters.filter((m) => matterLabel(m).toLowerCase().includes(q));
  }, [matters, search]);

  const handlePick = async (matterId: string) => {
    setFiling(matterId);
    const text = stripVoiceNoteFrontmatter(noteContent);
    await fileDictationAsMeeting(text, matterId, new Date().toISOString());
    setFiling(null);
    onOpenChange(false);
    onFiled(matterId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('meetings.dictation.dialog-title')}</DialogTitle>
        </DialogHeader>
        <Input
          data-testid="file-as-meeting-search"
          placeholder={t('meetings.dictation.search-placeholder')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
        />
        <div style={{ maxHeight: 280, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid="file-as-meeting-matter-row"
              disabled={filing !== null}
              onClick={() => { void handlePick(m.id); }}
              style={{ textAlign: 'left', border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-md)', padding: '8px 10px', background: 'transparent', cursor: filing ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 'var(--kp-font-sm)' }}
            >
              {matterLabel(m)}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => { onOpenChange(false); }}>
            {t('meetings.dictation.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FileAsMeetingDialog;
