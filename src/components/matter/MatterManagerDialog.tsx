/**
 * MatterManagerDialog (WS-B/C app) — create, rename, delete matters and map
 * each matter to one or more workspace folders.
 *
 * A matter maps to one or more folders; any file under a mapped folder belongs
 * to the matter, and indexing tags those files with the matter id. Changing a
 * mapping re-indexes the affected files (handled by useMemoryWiring's
 * subscription to the matter store).
 *
 * Light theme, navy accent, lean. Folder mapping is done by checking folders
 * from the current workspace tree — the simplest real model (folder = matter).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, FolderOpen, Mail, Plus, Trash2, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useMatters, useMatterStore } from '@/stores/matterStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileNode } from '@/types/workspace';
import { mailConnectedAccounts, type ConnectedAccount } from '@/utils/mail-commands';
import { mailFolderKey } from '@/modules/memory/matterResolver';

export interface MatterManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Collect every folder path in the workspace tree (depth-first, sorted). */
function collectFolderPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]) => {
    for (const n of ns) {
      if (n.type === 'folder') {
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return out.sort();
}

/** A short label for a folder path relative to the workspace root. */
function relLabel(path: string, root: string | null): string {
  if (!root) return path;
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const p = path.replace(/\\/g, '/');
  return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

export function MatterManagerDialog({ open, onOpenChange }: MatterManagerDialogProps) {
  const { t } = useTranslation();
  const matters = useMatters();
  const {
    createMatter,
    renameMatter,
    deleteMatter,
    addFolderPath,
    removeFolderPath,
    addMailFolderPath,
    removeMailFolderPath,
  } = useMatterStore();
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const fileTree = useWorkspaceStore((s) => s.fileTree);

  const folderPaths = useMemo(() => collectFolderPaths(fileTree), [fileTree]);

  // Connected mail accounts offered for an account-level mail -> matter mapping.
  const [mailAccounts, setMailAccounts] = useState<ConnectedAccount[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    mailConnectedAccounts()
      .then((accts) => {
        if (!cancelled) setMailAccounts(accts);
      })
      .catch(() => {
        /* no mail accounts / browser mode — leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const [newName, setNewName] = useState('');
  const [newClient, setNewClient] = useState('');

  const handleCreate = () => {
    if (!newName.trim() && !newClient.trim()) return;
    createMatter({ name: newName, client: newClient });
    setNewName('');
    setNewClient('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="matter-manager-dialog"
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            {t('matter.manager.title')}
          </DialogTitle>
          <DialogDescription>{t('matter.manager.description')}</DialogDescription>
        </DialogHeader>

        {/* Create */}
        <div className="rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="matter-new-name" className="text-xs">
                {t('matter.manager.matter-name')}
              </Label>
              <Input
                id="matter-new-name"
                data-testid="matter-new-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                }}
                placeholder={t('matter.manager.matter-name-placeholder')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="matter-new-client" className="text-xs">
                {t('matter.manager.client-name')}
              </Label>
              <Input
                id="matter-new-client"
                data-testid="matter-new-client"
                value={newClient}
                onChange={(e) => {
                  setNewClient(e.target.value);
                }}
                placeholder={t('matter.manager.client-name-placeholder')}
              />
            </div>
          </div>
          <Button
            data-testid="matter-create-button"
            size="sm"
            className="mt-3 gap-2"
            onClick={handleCreate}
            disabled={!newName.trim() && !newClient.trim()}
          >
            <Plus className="h-4 w-4" />
            {t('matter.manager.create')}
          </Button>
        </div>

        {/* Existing matters */}
        <div className="space-y-3" data-testid="matter-list">
          {matters.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {t('matter.manager.empty')}
            </p>
          ) : (
            matters.map((m) => (
              <div
                key={m.id}
                data-testid={`matter-row-${m.id}`}
                className="rounded-md border p-3 space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    data-testid={`matter-name-${m.id}`}
                    value={m.name}
                    onChange={(e) => {
                      renameMatter(m.id, { name: e.target.value });
                    }}
                    className="h-8 text-sm font-medium"
                    aria-label={t('matter.manager.matter-name')}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      data-testid={`matter-client-${m.id}`}
                      value={m.client}
                      onChange={(e) => {
                        renameMatter(m.id, { client: e.target.value });
                      }}
                      className="h-8 text-sm"
                      aria-label={t('matter.manager.client-name')}
                    />
                    <Button
                      data-testid={`matter-delete-${m.id}`}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        deleteMatter(m.id);
                      }}
                      aria-label={t('matter.manager.delete')}
                      title={t('matter.manager.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Folder mapping */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('matter.manager.folders-label')}
                  </p>
                  {folderPaths.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('matter.manager.no-folders')}
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto rounded border divide-y">
                      {folderPaths.map((fp) => {
                        const checked = m.folderPaths.includes(fp);
                        return (
                          <button
                            key={fp}
                            type="button"
                            data-testid={`matter-folder-${m.id}-${fp}`}
                            data-checked={checked ? 'true' : 'false'}
                            onClick={() => {
                              if (checked) removeFolderPath(m.id, fp);
                              else addFolderPath(m.id, fp);
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
                              checked && 'bg-primary/5',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/40',
                              )}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{relLabel(fp, rootPath)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Email account mapping (account-level: every folder in the account) */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('matter.manager.mail-label')}
                  </p>
                  {mailAccounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('matter.manager.no-mail-accounts')}
                    </p>
                  ) : (
                    <div className="rounded border divide-y">
                      {mailAccounts.map((acct) => {
                        const key = mailFolderKey(acct.provider, acct.account);
                        const checked = (m.mailFolderPaths ?? []).includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            data-testid={`matter-mail-${m.id}-${key}`}
                            data-checked={checked ? 'true' : 'false'}
                            onClick={() => {
                              if (checked) removeMailFolderPath(m.id, key);
                              else addMailFolderPath(m.id, key);
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
                              checked && 'bg-primary/5',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/40',
                              )}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{acct.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {mailAccounts.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t('matter.manager.mail-account-hint')}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MatterManagerDialog;
