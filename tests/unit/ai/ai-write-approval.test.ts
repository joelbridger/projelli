/**
 * BUG-060 — per-action approval for the AI's chat file tools. These are the PURE
 * rules that decide, given the user's chosen approval mode and the operation the
 * AI wants to run, whether to pause for approval BEFORE applying (and, in batch
 * mode, whether to collect it for end-of-turn review). Keeping this logic pure
 * makes the security-critical decision testable without any UI or async wiring.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyWriteOp,
  isRiskyOp,
  needsPreApproval,
  collectsForBatchReview,
  type AiWriteOp,
} from '@/platform/ai/aiWriteApproval';

describe('classifyWriteOp', () => {
  it('a write to a NON-existent path is a create (not risky)', () => {
    const op = classifyWriteOp({ tool: 'write_file', path: 'notes/new.md', destExists: false });
    expect(op).toEqual({ kind: 'create_file', path: 'notes/new.md' });
  });

  it('a write to an EXISTING path is an overwrite (risky)', () => {
    const op = classifyWriteOp({ tool: 'write_file', path: 'contract.docx', destExists: true });
    expect(op).toEqual({ kind: 'overwrite_file', path: 'contract.docx' });
  });

  it('create_folder is its own (non-risky) kind', () => {
    const op = classifyWriteOp({ tool: 'create_folder', path: 'Clients/Acme', destExists: false });
    expect(op).toEqual({ kind: 'create_folder', path: 'Clients/Acme' });
  });

  it('a move onto an EMPTY destination is a plain move', () => {
    const op = classifyWriteOp({ tool: 'move_file', from: 'a.md', to: 'b.md', destExists: false });
    expect(op).toEqual({ kind: 'move_file', from: 'a.md', to: 'b.md', destExists: false });
  });

  it('a move onto an EXISTING destination is flagged (it overwrites)', () => {
    const op = classifyWriteOp({ tool: 'move_file', from: 'a.md', to: 'b.md', destExists: true });
    expect(op).toEqual({ kind: 'move_file', from: 'a.md', to: 'b.md', destExists: true });
  });

  it('delete_file is its own kind', () => {
    const op = classifyWriteOp({ tool: 'delete_file', path: 'old.md', destExists: true });
    expect(op).toEqual({ kind: 'delete_file', path: 'old.md' });
  });
});

describe('isRiskyOp — "changes or removes something that already exists"', () => {
  const risky: AiWriteOp[] = [
    { kind: 'overwrite_file', path: 'x' },
    { kind: 'delete_file', path: 'x' },
    { kind: 'move_file', from: 'a', to: 'b', destExists: true },
  ];
  const safe: AiWriteOp[] = [
    { kind: 'create_file', path: 'x' },
    { kind: 'create_folder', path: 'x' },
    { kind: 'move_file', from: 'a', to: 'b', destExists: false },
  ];
  it.each(risky)('risky: %o', (op) => expect(isRiskyOp(op)).toBe(true));
  it.each(safe)('safe: %o', (op) => expect(isRiskyOp(op)).toBe(false));
});

describe('needsPreApproval — pause BEFORE applying', () => {
  const overwrite: AiWriteOp = { kind: 'overwrite_file', path: 'x' };
  const create: AiWriteOp = { kind: 'create_file', path: 'x' };
  const del: AiWriteOp = { kind: 'delete_file', path: 'x' };

  it('"always" pauses for every change, even a create', () => {
    expect(needsPreApproval('always', create)).toBe(true);
    expect(needsPreApproval('always', overwrite)).toBe(true);
    expect(needsPreApproval('always', del)).toBe(true);
  });

  it('"risky" pauses only for overwrite/delete/move-over, not create', () => {
    expect(needsPreApproval('risky', create)).toBe(false);
    expect(needsPreApproval('risky', overwrite)).toBe(true);
    expect(needsPreApproval('risky', del)).toBe(true);
  });

  it('"batch" never pauses before applying (it reviews at the end)', () => {
    expect(needsPreApproval('batch', create)).toBe(false);
    expect(needsPreApproval('batch', overwrite)).toBe(false);
    expect(needsPreApproval('batch', del)).toBe(false);
  });
});

describe('collectsForBatchReview — record for end-of-turn review', () => {
  const op: AiWriteOp = { kind: 'overwrite_file', path: 'x' };
  it('only "batch" mode collects applied changes for review', () => {
    expect(collectsForBatchReview('batch', op)).toBe(true);
    expect(collectsForBatchReview('risky', op)).toBe(false);
    expect(collectsForBatchReview('always', op)).toBe(false);
  });
});
