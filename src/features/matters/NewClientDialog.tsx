/**
 * NewClientDialog (feedback line 14) — the calm, one-field way to add a client.
 *
 * Creating a client is ONE small modal: a display name (required), nothing else.
 * No folders, no email mapping, no privilege toggle, no helper paragraphs, and
 * NO list of every other client expanded below it — all of that used to live in
 * the create flow (MatterManagerDialog) and made adding a client feel heavy.
 * Enrichment (folders, email, isolation, sharing) now happens INSIDE the client,
 * reachable from its row menu -> "Client settings".
 *
 * On create we land the user INSIDE the new client's Client Map (its Missing
 * panel is the natural next step), by dispatching the same matter-launch event
 * the rail uses.
 *
 * Light theme, lean. The new client still gets its own scoped workspace subfolder
 * by default (matter isolation from the first action) — that happens invisibly;
 * it is not something the user has to think about while creating.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { EV_MATTER_LAUNCH } from '@/config/identity';
import {
  deriveNewClientFolderPath,
  ensureClientFolderOnDisk,
} from './matterManagerDialogHelpers';

export interface NewClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewClientDialog({ open, onOpenChange }: NewClientDialogProps) {
  const { t } = useTranslation();
  const entityLabel = useEntityLabel();
  const createMatter = useMatterStore((s) => s.createMatter);
  const matters = useMatterStore((s) => s.matters);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  const [name, setName] = useState('');
  // Re-entrancy guard: a double/triple-clicked Create must create exactly one
  // client (a plain ref takes effect immediately, before React re-renders the
  // disabled button — matching the old MatterManagerDialog guard).
  const [isCreating, setIsCreating] = useState(false);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus each time the dialog opens.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the one field when the dialog opens so a reopen starts blank.
      setName('');
      setIsCreating(false);
      submittingRef.current = false;
      // Focus after the dialog's own open animation/focus trap settles.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => {
        window.clearTimeout(id);
      };
    }
    return undefined;
  }, [open]);

  const handleCreate = () => {
    if (submittingRef.current) return;
    const displayName = name.trim();
    if (!displayName) return;
    submittingRef.current = true;
    setIsCreating(true);

    // Give the new client its OWN workspace subfolder by default, so its
    // documents/imports are scoped and isolated from the very first action.
    // Uniquify against every other client's folders (matter isolation). The
    // store's createMatter re-verifies this against LIVE state too.
    const takenFolderPaths = matters.flatMap((m) => m.folderPaths);
    const clientFolder = deriveNewClientFolderPath(
      '',
      displayName,
      rootPath,
      takenFolderPaths,
    );
    const created = createMatter({
      name: displayName,
      client: '',
      ...(clientFolder ? { folderPaths: [clientFolder] } : {}),
    });
    // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort disk mkdir; ensureClientFolderOnDisk swallows its own errors and the client is already scoped via folderPaths.
    if (clientFolder) void ensureClientFolderOnDisk(clientFolder);

    onOpenChange(false);
    // Land inside the new client's Client Map (its Missing panel is the natural
    // next step). Same event the rail uses to open a client.
    window.dispatchEvent(
      new CustomEvent(EV_MATTER_LAUNCH, {
        detail: { matterId: created.id, surface: 'matters' },
      }),
    );

    // Release on the next tick (catches same-burst re-clicks).
    window.setTimeout(() => {
      submittingRef.current = false;
      setIsCreating(false);
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-client-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t('matter.new-client.title', { entity: entityLabel.one })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('matter.new-client.description', { entity: entityLabel.one })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="new-client-name">
            {t('matter.new-client.name-label')}
          </Label>
          <Input
            id="new-client-name"
            ref={inputRef}
            data-testid="new-client-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder={t('matter.new-client.name-placeholder')}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            data-testid="new-client-cancel"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('matter.new-client.cancel')}
          </Button>
          <Button
            data-testid="new-client-create"
            className="gap-2"
            onClick={handleCreate}
            disabled={isCreating || !name.trim()}
          >
            <Plus className="h-4 w-4" />
            {t('matter.new-client.create', { entity: entityLabel.one })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewClientDialog;
