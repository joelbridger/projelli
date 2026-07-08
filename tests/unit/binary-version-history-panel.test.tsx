// WS-A / A5 — BinaryVersionHistoryPanel (the .docx version-history UI).
//
// Verifies (with a mock engine + in-memory FS):
//   - the version list renders snapshots with author + size;
//   - selecting a version builds a DOCX TEXT diff from the engine's extracted
//     text of the snapshot vs the current file (byte diff is meaningless);
//   - restore copies the snapshot back and fires onRestored so the editor can
//     reload.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The engine is "available" and returns a DOM whose plain text depends on the
// opened path, so the two versions produce a visible text diff.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'docx_open') {
      const path = String(args['path']);
      // Snapshot path (under .versions/) => old text; live file => new text.
      const text = path.includes('.versions/')
        ? 'The quick brown fox.'
        : 'The quick red fox jumped.';
      return {
        formatVersion: 1,
        body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text }] }],
        comments: {},
      };
    }
    throw new Error(`unexpected invoke ${cmd}`);
  }),
}));

import '@/i18n';
import { BinaryVersionHistoryPanel } from '@/features/documents/versioning';
import {
  BinaryVersionService,
  toWorkspaceRelative,
  __resetBinaryVersionService,
  getBinaryVersionService,
  type VersionFS,
} from '@/features/documents/versioning';

const ROOT = '/ws';

class MemFS implements VersionFS {
  files = new Map<string, Uint8Array>();
  private key(p: string): string {
    return toWorkspaceRelative(p, ROOT);
  }
  async exists(p: string) {
    return this.files.has(this.key(p));
  }
  async readFile(p: string) {
    const b = this.files.get(this.key(p));
    if (!b) throw new Error(`ENOENT ${p}`);
    return new TextDecoder().decode(b);
  }
  async writeFile(p: string, c: string) {
    this.files.set(this.key(p), new TextEncoder().encode(c));
  }
  async readFileBinary(p: string) {
    const b = this.files.get(this.key(p));
    if (!b) throw new Error(`ENOENT ${p}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  async writeFileBinary(p: string, c: ArrayBuffer) {
    this.files.set(this.key(p), new Uint8Array(c));
  }
  async delete(p: string) {
    this.files.delete(this.key(p));
  }
  async list(p: string): Promise<Array<{ name: string }>> {
    const dirKey = this.key(p);
    const prefix = dirKey.endsWith('/') ? dirKey : `${dirKey}/`;
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) names.add(name);
      }
    }
    return Array.from(names).map((name) => ({ name }));
  }
  getRootPath() {
    return ROOT;
  }
}

function docxBytes(tag: string): ArrayBuffer {
  return new TextEncoder().encode(`PK${tag}`).buffer as ArrayBuffer;
}

describe('BinaryVersionHistoryPanel', () => {
  let fs: MemFS;

  beforeEach(async () => {
    __resetBinaryVersionService();
    fs = new MemFS();
    // Seed a .docx with two snapshots via the service so the panel has history.
    await fs.writeFileBinary('/ws/docs/Contract.docx', docxBytes('current'));
    const svc = new BinaryVersionService(fs);
    await svc.saveVersionFromBytes('/ws/docs/Contract.docx', docxBytes('snap1'), {
      author: 'user',
      message: 'Auto-saved version',
    });
    await svc.saveVersionFromBytes('/ws/docs/Contract.docx', docxBytes('snap2'), {
      author: 'ai',
      message: 'AI redline',
    });
    // Bind the shared instance to this FS so the panel uses it.
    getBinaryVersionService(fs);
  });

  it('renders the snapshot list with author labels', async () => {
    render(
      <BinaryVersionHistoryPanel
        filePath="/ws/docs/Contract.docx"
        fileName="Contract.docx"
        fs={fs}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('binary-version-row')).toHaveLength(2);
    });

    const authors = screen
      .getAllByTestId('binary-version-author')
      .map((el) => el.textContent);
    // Newest first: the AI redline, then the user save.
    expect(authors[0]).toContain('Lantern AI');
    expect(authors[1]).toContain('You');
  });

  it('renders a DOCX text diff from the two versions extracted text', async () => {
    render(
      <BinaryVersionHistoryPanel
        filePath="/ws/docs/Contract.docx"
        fileName="Contract.docx"
        fs={fs}
        onClose={() => {}}
      />,
    );

    const rows = await screen.findAllByTestId('binary-version-row');
    fireEvent.click(rows[0]!);

    // The diff renders the engine-extracted plain text of both versions.
    await waitFor(() => {
      expect(screen.getByText(/quick red fox jumped/i)).toBeInTheDocument();
    });
    // The note clarifying this is a text comparison is shown for .docx.
    expect(
      screen.getByText(/text comparison/i),
    ).toBeInTheDocument();
  });

  it('restores a snapshot and fires onRestored with the restored bytes', async () => {
    const onRestored = vi.fn();
    const onClose = vi.fn();
    render(
      <BinaryVersionHistoryPanel
        filePath="/ws/docs/Contract.docx"
        fileName="Contract.docx"
        fs={fs}
        onRestored={onRestored}
        onClose={onClose}
      />,
    );

    const restoreBtns = await screen.findAllByTestId('binary-version-restore');
    // Restore the OLDEST (user) version = last row's button.
    fireEvent.click(restoreBtns[restoreBtns.length - 1]!);

    // Confirm in the dialog.
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledTimes(1);
    });
    // The live file now holds the restored snapshot bytes (snap1).
    const live = await fs.readFileBinary('/ws/docs/Contract.docx');
    expect(new TextDecoder().decode(live)).toBe('PKsnap1');
    expect(onClose).toHaveBeenCalled();
  });
});
