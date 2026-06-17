/**
 * vaultClient.test.ts
 *
 * Unit tests for src/platform/firm/vault/vaultClient.ts.
 *
 * Strategy:
 *   - Mock @tauri-apps/api/core (invoke + isTauri) so we can assert the exact
 *     command names and argument shapes sent by each wrapper.
 *   - Mock @/modules/firm/keyWrap's wrapMatterKey so we can count its calls
 *     and assert provisionEscrow drops the plaintext VMK.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared invoke mock ───────────────────────────────────────────────────────
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  isTauri: () => true,
}));

// ── keyWrap mock — tracks calls, returns predictable wrapped value ────────────
const wrapMatterKeyMock = vi.fn(async (_vmkB64: string, _pub: JsonWebKey, _epoch: number) => {
  return 'wrapped-vmk-blob-b64';
});
vi.mock('@/platform/firm/keyWrap', () => ({
  wrapMatterKey: (...a: unknown[]) => wrapMatterKeyMock(...(a as [string, JsonWebKey, number])),
}));

// Import after mocks are established.
import {
  vaultStatus,
  vaultCreate,
  vaultReadFile,
  vaultWriteFile,
  vaultUnlockWithRecovery,
  vaultExportVmkForEscrow,
  vaultSetEscrowWraps,
  vaultEncryptAll,
  vaultDecryptAll,
  vaultDisable,
  provisionEscrow,
} from '@/platform/firm/vault/vaultClient';

// ── Shared setup ─────────────────────────────────────────────────────────────
const WORKSPACE = '/home/user/test-workspace';
const EPOCH = 1;

beforeEach(() => {
  invokeMock.mockReset();
  wrapMatterKeyMock.mockReset();
  // Default: return wrapped value
  wrapMatterKeyMock.mockImplementation(async () => 'wrapped-vmk-blob-b64');
});

// ── vault_status ─────────────────────────────────────────────────────────────

describe('vaultStatus', () => {
  it('calls vault_status with workspace string', async () => {
    invokeMock.mockResolvedValueOnce({ enabled: false, locked: false, hasEscrow: false, vaultId: null });

    const result = await vaultStatus(WORKSPACE);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith('vault_status', { workspace: WORKSPACE });
    expect(result.enabled).toBe(false);
  });
});

// ── vault_create ─────────────────────────────────────────────────────────────

describe('vaultCreate', () => {
  it('calls vault_create with workspace and escrow flag', async () => {
    invokeMock.mockResolvedValueOnce({ recoveryPhrase: 'word1 word2', vaultId: 'abc123' });

    const result = await vaultCreate(WORKSPACE, false);

    expect(invokeMock).toHaveBeenCalledWith('vault_create', { workspace: WORKSPACE, escrow: false });
    expect(result.recoveryPhrase).toBe('word1 word2');
  });

  it('passes escrow=true when requested', async () => {
    invokeMock.mockResolvedValueOnce({ recoveryPhrase: 'foo bar', vaultId: 'def456' });

    await vaultCreate(WORKSPACE, true);

    expect(invokeMock).toHaveBeenCalledWith('vault_create', { workspace: WORKSPACE, escrow: true });
  });
});

// ── vault_read_file ───────────────────────────────────────────────────────────

describe('vaultReadFile', () => {
  it('calls vault_read_file with workspace and relPath', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    invokeMock.mockResolvedValueOnce(bytes);

    const result = await vaultReadFile(WORKSPACE, 'docs/contract.docx');

    expect(invokeMock).toHaveBeenCalledWith('vault_read_file', {
      workspace: WORKSPACE,
      relPath: 'docs/contract.docx',
    });
    expect(result).toBe(bytes);
  });
});

// ── vault_write_file ──────────────────────────────────────────────────────────

describe('vaultWriteFile', () => {
  it('calls vault_write_file with workspace, relPath, and bytes', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const bytes = new Uint8Array([4, 5, 6]);

    await vaultWriteFile(WORKSPACE, 'notes/memo.txt', bytes);

    expect(invokeMock).toHaveBeenCalledWith('vault_write_file', {
      workspace: WORKSPACE,
      relPath: 'notes/memo.txt',
      bytes,
    });
  });
});

// ── vault_unlock_with_recovery ────────────────────────────────────────────────

describe('vaultUnlockWithRecovery', () => {
  it('calls vault_unlock_with_recovery with workspace and phrase', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await vaultUnlockWithRecovery(WORKSPACE, 'word1 word2 word3');

    expect(invokeMock).toHaveBeenCalledWith('vault_unlock_with_recovery', {
      workspace: WORKSPACE,
      phrase: 'word1 word2 word3',
    });
  });
});

// ── vault_export_vmk_for_escrow ───────────────────────────────────────────────

describe('vaultExportVmkForEscrow', () => {
  it('calls vault_export_vmk_for_escrow with workspace', async () => {
    invokeMock.mockResolvedValueOnce('vmk-b64-string');

    const result = await vaultExportVmkForEscrow(WORKSPACE);

    expect(invokeMock).toHaveBeenCalledWith('vault_export_vmk_for_escrow', { workspace: WORKSPACE });
    expect(result).toBe('vmk-b64-string');
  });
});

// ── vault_set_escrow_wraps ────────────────────────────────────────────────────

describe('vaultSetEscrowWraps', () => {
  it('calls vault_set_escrow_wraps with workspace, epoch, and wraps array', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const wraps = [
      { user_id: 'u1', device_id: 'd1', wrapped_b64: 'abc==' },
    ];

    await vaultSetEscrowWraps(WORKSPACE, EPOCH, wraps);

    expect(invokeMock).toHaveBeenCalledWith('vault_set_escrow_wraps', {
      workspace: WORKSPACE,
      epoch: EPOCH,
      wraps,
    });
  });
});

// ── vault_encrypt_all ─────────────────────────────────────────────────────────

describe('vaultEncryptAll', () => {
  it('calls vault_encrypt_all with workspace', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await vaultEncryptAll(WORKSPACE);

    expect(invokeMock).toHaveBeenCalledWith('vault_encrypt_all', { workspace: WORKSPACE });
  });
});

// ── vault_decrypt_all ─────────────────────────────────────────────────────────

describe('vaultDecryptAll', () => {
  it('calls vault_decrypt_all with workspace', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await vaultDecryptAll(WORKSPACE);

    expect(invokeMock).toHaveBeenCalledWith('vault_decrypt_all', { workspace: WORKSPACE });
  });
});

// ── vault_disable ─────────────────────────────────────────────────────────────

describe('vaultDisable', () => {
  it('calls vault_disable with workspace', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await vaultDisable(WORKSPACE);

    expect(invokeMock).toHaveBeenCalledWith('vault_disable', { workspace: WORKSPACE });
  });
});

// ── provisionEscrow ───────────────────────────────────────────────────────────

describe('provisionEscrow', () => {
  const adminDevices = [
    { user_id: 'admin1', device_id: 'dev-a', pubkey_jwk: { kty: 'EC', crv: 'P-256' } as JsonWebKey },
    { user_id: 'admin2', device_id: 'dev-b', pubkey_jwk: { kty: 'EC', crv: 'P-256' } as JsonWebKey },
  ];

  beforeEach(() => {
    // vault_export_vmk_for_escrow → returns a plaintext VMK (base64)
    invokeMock.mockResolvedValueOnce('plaintext-vmk-b64');
    // vault_set_escrow_wraps → succeeds
    invokeMock.mockResolvedValueOnce(undefined);
  });

  it('calls vault_export_vmk_for_escrow once', async () => {
    await provisionEscrow(WORKSPACE, adminDevices, EPOCH);

    const exportCall = invokeMock.mock.calls.find(
      (c) => c[0] === 'vault_export_vmk_for_escrow',
    );
    expect(exportCall).toBeDefined();
    expect(exportCall![1]).toEqual({ workspace: WORKSPACE });
  });

  it('calls wrapMatterKey once per admin device', async () => {
    await provisionEscrow(WORKSPACE, adminDevices, EPOCH);

    // Two admin devices → two wrap calls.
    expect(wrapMatterKeyMock).toHaveBeenCalledTimes(adminDevices.length);

    // Each call receives the plaintext VMK, that device's pubkey, and the epoch.
    for (const [i, device] of adminDevices.entries()) {
      expect(wrapMatterKeyMock).toHaveBeenNthCalledWith(
        i + 1,
        'plaintext-vmk-b64',
        device.pubkey_jwk,
        EPOCH,
      );
    }
  });

  it('calls vault_set_escrow_wraps with the assembled wraps array', async () => {
    await provisionEscrow(WORKSPACE, adminDevices, EPOCH);

    const setCall = invokeMock.mock.calls.find(
      (c) => c[0] === 'vault_set_escrow_wraps',
    );
    expect(setCall).toBeDefined();
    const args = setCall![1] as { workspace: string; epoch: number; wraps: unknown[] };
    expect(args.workspace).toBe(WORKSPACE);
    expect(args.epoch).toBe(EPOCH);
    expect(args.wraps).toHaveLength(adminDevices.length);

    // Each entry has user_id, device_id, wrapped_b64.
    for (const [i, device] of adminDevices.entries()) {
      const wrap = args.wraps[i] as { user_id: string; device_id: string; wrapped_b64: string };
      expect(wrap.user_id).toBe(device.user_id);
      expect(wrap.device_id).toBe(device.device_id);
      expect(wrap.wrapped_b64).toBe('wrapped-vmk-blob-b64');
    }
  });

  it('provisionEscrow drops the plaintext VMK after wrapping (does not retain it)', async () => {
    // We verify this structurally: after provisionEscrow resolves, the only
    // place the plaintext VMK appeared is as an argument to wrapMatterKey.
    // The function should not return the VMK, and the final vault_set_escrow_wraps
    // call must NOT contain the plaintext VMK string anywhere.
    const result = await provisionEscrow(WORKSPACE, adminDevices, EPOCH);

    // provisionEscrow returns void — no VMK leaks in return value.
    expect(result).toBeUndefined();

    // The vault_set_escrow_wraps args must contain only wrapped blobs, never
    // the plaintext VMK.
    const setCall = invokeMock.mock.calls.find(
      (c) => c[0] === 'vault_set_escrow_wraps',
    );
    const argsJson = JSON.stringify(setCall![1]);
    expect(argsJson).not.toContain('plaintext-vmk-b64');
  });

  it('handles a single admin device correctly', async () => {
    // Reset and re-setup mocks for a fresh scenario with one device.
    invokeMock.mockReset();
    wrapMatterKeyMock.mockReset();
    wrapMatterKeyMock.mockResolvedValue('single-device-wrap');
    invokeMock.mockResolvedValueOnce('vmk-for-single'); // export
    invokeMock.mockResolvedValueOnce(undefined);         // set

    const singleDevice = [adminDevices[0]!];
    await provisionEscrow(WORKSPACE, singleDevice, 2);

    expect(wrapMatterKeyMock).toHaveBeenCalledOnce();
    expect(wrapMatterKeyMock).toHaveBeenCalledWith('vmk-for-single', singleDevice[0]!.pubkey_jwk, 2);
  });
});
