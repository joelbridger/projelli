/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy is catalogued with the frozen CRM screens. */
import { useState } from 'react';
import { CheckCircle2, FolderPlus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { createFirmWorkspace, openFirmWorkspace } from './workspaceSwitching';

const panelStyle = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const mutedStyle = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;

function folderName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? 'Unnamed firm space';
}

export function WorkspacesSurface() {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const recentWorkspaces = useWorkspaceStore((state) => state.recentWorkspaces);
  const [newPath, setNewPath] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const perform = async (action: () => Promise<boolean>, success: string) => {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const switched = await action();
      if (switched) setMessage(success);
      else setMessage('You stayed in the firm space you already had open.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open that firm space. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const chooseFolder = async () => {
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: 'Choose a folder for this firm space' });
      if (typeof selected === 'string') setNewPath(selected);
    } catch {
      setError('The folder picker did not open. You can type the folder location instead.');
    }
  };

  return <div data-testid="crm-workspaces-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
    <SurfaceHeader Icon={RefreshCw} title="Firm spaces" description="Keep separate businesses or test data in separate, private spaces." />
    <section data-testid="crm-workspace-isolation-promise" style={{ ...panelStyle, borderColor: 'var(--kp-assured)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={20} color="var(--kp-assured)" /><strong>Each firm space has its own encrypted data store.</strong></div>
      <p style={{ ...mutedStyle, marginBottom: 0 }}>Clients, tasks, notes, and activity from one firm space never appear in another.</p>
    </section>
    <section style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Current firm space</h3>
      <p data-testid="crm-workspace-current" style={{ marginBottom: 0 }}>{rootPath ? folderName(rootPath) : 'No firm space is open yet.'}</p>
    </section>
    <section style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Create a firm space</h3>
      <p style={mutedStyle}>Choose an empty folder. Its name becomes the name you see here.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}><label style={{ display: 'block', flex: '1 1 420px' }}>Firm-space folder
        <input data-testid="crm-workspace-new-path" value={newPath} onChange={(event) => { setNewPath(event.target.value); }} placeholder="Choose a folder for this firm space" disabled={working} />
      </label><Button data-testid="crm-workspace-choose-folder" variant="secondary" disabled={working} onClick={() => { void chooseFolder(); }}>Choose folder</Button></div>
      <Button data-testid="crm-workspace-create" iconLeft={FolderPlus} disabled={working || !newPath.trim()} style={{ marginTop: 10 }} onClick={() => { void perform(async () => createFirmWorkspace(newPath), 'Your new firm space is ready.'); }}>Create firm space</Button>
    </section>
    <section style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Switch firm spaces</h3>
      {recentWorkspaces.length === 0 ? <p data-testid="crm-workspaces-empty" style={{ ...mutedStyle, marginBottom: 0 }}>Create another firm space to switch between them here.</p> : <div data-testid="crm-workspace-list">{recentWorkspaces.map((workspace, index) => {
        const current = workspace.path === rootPath;
        return <div key={workspace.path} data-testid={`crm-workspace-row-${index}`} data-workspace-path={workspace.path} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div><strong>{workspace.name || folderName(workspace.path)}</strong>{current && <span data-testid="crm-workspace-current-badge" style={{ ...mutedStyle, marginLeft: 8 }}>Open now</span>}</div>
          <Button data-testid={`crm-workspace-open-${index}`} size="sm" variant="secondary" disabled={working || current} onClick={() => { void perform(async () => openFirmWorkspace(workspace.path), `Opened ${workspace.name || folderName(workspace.path)}.`); }}>{current ? 'Open now' : 'Open'}</Button>
        </div>;
      })}</div>}
    </section>
    {message && <p data-testid="crm-workspace-status" role="status"><CheckCircle2 size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{message}</p>}
    {error && <p data-testid="crm-workspace-error" role="alert">{error}</p>}
  </div>;
}
