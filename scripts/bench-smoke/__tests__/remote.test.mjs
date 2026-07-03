import { describe, it, expect } from 'vitest';
import {
  psQuote,
  buildRemoteCommandString,
  buildSshArgs,
  buildDesktopDriveInvocation,
  buildProbeInvocation,
  toScpRemotePath,
  buildScpDownloadInvocation,
} from '../remote.mjs';

const TARGET = { sshUser: 'james', sshHost: '100.127.67.22', repoDir: 'C:\\lantern-plus' };

describe('psQuote', () => {
  it('wraps a plain arg in single quotes', () => {
    expect(psQuote('docx-draft-follow-up')).toBe("'docx-draft-follow-up'");
  });

  it('doubles embedded single quotes (PowerShell escaping)', () => {
    expect(psQuote("it's a test")).toBe("'it''s a test'");
  });

  it('does not need to escape double quotes', () => {
    expect(psQuote('say "hi"')).toBe(`'say "hi"'`);
  });
});

describe('buildRemoteCommandString', () => {
  it('cds into the repo, sets the CDP port env var, then runs desktop-drive.mjs with quoted args', () => {
    const cmd = buildRemoteCommandString(TARGET, ['type', 'to-field', "Jennifer's note"]);
    expect(cmd).toBe(
      "cd 'C:\\lantern-plus'; [Environment]::SetEnvironmentVariable('DESKTOP_CDP_PORT','9223'); " +
        "node scripts/desktop-drive.mjs 'type' 'to-field' 'Jennifer''s note'"
    );
  });
});

describe('buildSshArgs / buildDesktopDriveInvocation', () => {
  it('targets user@host and includes non-interactive ssh options', () => {
    const args = buildSshArgs(TARGET, 'exit 0');
    expect(args).toContain('james@100.127.67.22');
    expect(args).toContain('exit 0');
    expect(args).toEqual(expect.arrayContaining(['-o', 'BatchMode=yes']));
  });

  it('buildDesktopDriveInvocation returns an ssh invocation', () => {
    const inv = buildDesktopDriveInvocation(TARGET, ['snapshot']);
    expect(inv.file).toBe('ssh');
    expect(inv.args.join(' ')).toContain('node scripts/desktop-drive.mjs');
    expect(inv.args.join(' ')).toContain("'snapshot'");
  });

  it('buildProbeInvocation is a bare exit 0', () => {
    const inv = buildProbeInvocation(TARGET);
    expect(inv.args.at(-1)).toBe('exit 0');
  });
});

describe('toScpRemotePath / buildScpDownloadInvocation', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toScpRemotePath('C:\\lantern-plus\\bench-smoke-tmp\\shot.jpeg')).toBe('C:/lantern-plus/bench-smoke-tmp/shot.jpeg');
  });

  it('builds a scp invocation with user@host:remotepath and a local destination', () => {
    const inv = buildScpDownloadInvocation(TARGET, 'C:\\lantern-plus\\shot.jpeg', '/tmp/out/shot.jpeg');
    expect(inv.file).toBe('scp');
    expect(inv.args).toContain('james@100.127.67.22:C:/lantern-plus/shot.jpeg');
    expect(inv.args).toContain('/tmp/out/shot.jpeg');
  });
});
