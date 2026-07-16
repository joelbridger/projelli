import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  auditActionLocaleKeyExists,
  emitAuditEntry,
  setAuditWriteEmitter,
  validateAuditActionDescriptors,
  type AuditWriteEmitter,
} from '@/features/audit';
import {
  publicAuditConsumerDescriptor,
  publicAuditConsumerEntry,
  runPublicAuditConsumer,
} from './test-fixtures/publicAuditConsumer';

afterEach(() => {
  setAuditWriteEmitter(null);
});

describe('public audit-write doorway', () => {
  it('awaits the installed writer with the exact typed entry and propagates its result', async () => {
    let resolveWriter:
      | ((value: Awaited<ReturnType<AuditWriteEmitter>>) => void)
      | undefined;
    const returnedEntry = {
      ...publicAuditConsumerEntry,
      id: 'audit_fixture_1',
      timestamp: '2026-07-16T00:00:00.000Z',
    };
    const writer = vi.fn<AuditWriteEmitter>(
      () =>
        new Promise((resolve) => {
          resolveWriter = resolve;
        })
    );
    setAuditWriteEmitter(writer);

    const pendingResult = runPublicAuditConsumer();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(publicAuditConsumerEntry);

    let settled = false;
    const settlement = pendingResult.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    if (!resolveWriter) throw new Error('Expected the writer to be awaiting');
    resolveWriter(returnedEntry);
    await expect(pendingResult).resolves.toBe(returnedEntry);
    await settlement;
  });

  it('rejects clearly when App has not installed a writer', async () => {
    await expect(emitAuditEntry(publicAuditConsumerEntry)).rejects.toThrow(
      'Canonical audit writer is unavailable'
    );
  });

  it('removes the writer when App composition cleans up', async () => {
    const writer = vi.fn<AuditWriteEmitter>(() =>
      Promise.resolve({
        ...publicAuditConsumerEntry,
        id: 'audit_fixture_cleanup',
        timestamp: '2026-07-16T00:00:00.000Z',
      })
    );
    setAuditWriteEmitter(writer);
    setAuditWriteEmitter(null);

    await expect(runPublicAuditConsumer()).rejects.toThrow(
      'Canonical audit writer is unavailable'
    );
    expect(writer).not.toHaveBeenCalled();
  });

  it('supports a registered typed action through the public display and write contracts', async () => {
    expect(() => {
      validateAuditActionDescriptors(
        [publicAuditConsumerDescriptor],
        auditActionLocaleKeyExists
      );
    }).not.toThrow();

    const writer = vi.fn<AuditWriteEmitter>((entry) =>
      Promise.resolve({
        ...entry,
        id: 'audit_fixture_public_consumer',
        timestamp: '2026-07-16T00:00:00.000Z',
      })
    );
    setAuditWriteEmitter(writer);

    const result = await runPublicAuditConsumer();
    expect(result.action).toBe('user_action');
    expect(result.id).toBe('audit_fixture_public_consumer');
  });
});
