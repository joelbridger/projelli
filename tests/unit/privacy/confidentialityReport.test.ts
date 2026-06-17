import { describe, it, expect } from 'vitest';
import { buildConfidentialityReport, pickAttestation } from '@/platform/privacy/confidentialityReport';
import type { AuditEntry } from '@/platform/types/audit';

// Helper: build a minimal egress AuditEntry fixture
function egressEntry(overrides: {
  matterId?: string;
  mode: 'local-only' | 'direct' | 'assured';
  provider?: string;
  destination?: string;
  dataLeaves?: boolean;
  timestamp?: string;
}): AuditEntry {
  const matterId = overrides.matterId ?? 'matter_abc';
  return {
    id: `test_${Math.random()}`,
    timestamp: overrides.timestamp ?? '2026-06-17T10:00:00Z',
    action: 'egress',
    description: 'egress',
    model: 'claude-3-opus',
    inputs: {},
    outputs: {},
    userDecision: 'auto',
    metadata: {
      auditEventType: 'egress',
      provider: overrides.provider ?? 'anthropic',
      mode: overrides.mode,
      destination: overrides.destination ?? (overrides.mode === 'local-only' ? 'local' : overrides.mode === 'assured' ? 'assured-proxy' : 'provider-direct'),
      dataLeaves: overrides.dataLeaves ?? (overrides.mode !== 'local-only'),
      scope: { kind: 'matter', matterId, matterName: 'Garcia v. Meridian' },
    },
  };
}

const MATTER_ID = 'matter_abc';
const MATTER_NAME = 'Garcia v. Meridian';
const GENERATED_AT = '2026-06-17T12:00:00Z';

describe('pickAttestation', () => {
  it('returns "No AI activity" when no calls', () => {
    const text = pickAttestation({});
    expect(text).toMatch(/no AI activity/i);
  });

  it('all local-only: claims nothing left the machine', () => {
    const text = pickAttestation({ 'local-only': 3 });
    expect(text).toMatch(/nothing left this machine/i);
    expect(text).toMatch(/no third party saw/i);
  });

  it('all direct: mentions provider received prompts and Keepance not in path', () => {
    const text = pickAttestation({ direct: 2 });
    expect(text).toMatch(/your own API key/i);
    expect(text).toMatch(/Keepance was not in the path/i);
    expect(text).toMatch(/provider received the prompts/i);
  });

  it('all assured: mentions zero-retention proxy', () => {
    const text = pickAttestation({ assured: 1 });
    expect(text).toMatch(/zero-retention proxy/i);
    expect(text).toMatch(/Keepance retained no prompt/i);
  });

  it('mixed local+direct: mentions both honestly without overclaiming', () => {
    const text = pickAttestation({ 'local-only': 2, direct: 1 });
    expect(text).toMatch(/local model/i);
    expect(text).toMatch(/your own API key/i);
    // CRITICAL: must NOT say nothing left the machine
    expect(text).not.toMatch(/nothing left this machine/i);
  });

  it('mixed direct+assured: lists both', () => {
    const text = pickAttestation({ direct: 1, assured: 1 });
    expect(text).toMatch(/your own key/i);
    expect(text).toMatch(/zero-retention proxy/i);
  });
});

describe('buildConfidentialityReport', () => {
  it('all-local fixture: anyDataLeftMachine=false, allUnderOwnKeyOrLocal=true', () => {
    const entries: AuditEntry[] = [
      egressEntry({ mode: 'local-only', destination: 'local', dataLeaves: false }),
      egressEntry({ mode: 'local-only', destination: 'local', dataLeaves: false }),
    ];
    const report = buildConfidentialityReport(entries, { matterId: MATTER_ID, matterName: MATTER_NAME, generatedAt: GENERATED_AT });
    expect(report.totalCalls).toBe(2);
    expect(report.anyDataLeftMachine).toBe(false);
    expect(report.allUnderOwnKeyOrLocal).toBe(true);
    expect(report.byMode['local-only']).toBe(2);
    expect(report.attestation).toMatch(/nothing left this machine/i);
  });

  it('all-direct fixture: anyDataLeftMachine=true, allUnderOwnKeyOrLocal=true', () => {
    const entries: AuditEntry[] = [
      egressEntry({ mode: 'direct', destination: 'provider-direct', dataLeaves: true }),
      egressEntry({ mode: 'direct', destination: 'provider-direct', dataLeaves: true }),
    ];
    const report = buildConfidentialityReport(entries, { matterId: MATTER_ID, matterName: MATTER_NAME, generatedAt: GENERATED_AT });
    expect(report.totalCalls).toBe(2);
    expect(report.anyDataLeftMachine).toBe(true);
    expect(report.allUnderOwnKeyOrLocal).toBe(true);
    expect(report.byMode['direct']).toBe(2);
    expect(report.attestation).toMatch(/your own API key/i);
    expect(report.attestation).toMatch(/Keepance was not in the path/i);
    // Honesty check: must NOT claim nothing left
    expect(report.attestation).not.toMatch(/nothing left this machine/i);
  });

  it('assured fixture: mentions zero-retention proxy', () => {
    const entries: AuditEntry[] = [
      egressEntry({ mode: 'assured', destination: 'assured-proxy', dataLeaves: true }),
    ];
    const report = buildConfidentialityReport(entries, { matterId: MATTER_ID, matterName: MATTER_NAME, generatedAt: GENERATED_AT });
    expect(report.totalCalls).toBe(1);
    expect(report.attestation).toMatch(/zero-retention proxy/i);
  });

  it('mixed fixture: mentions both modes without overclaiming', () => {
    const entries: AuditEntry[] = [
      egressEntry({ mode: 'local-only', destination: 'local', dataLeaves: false }),
      egressEntry({ mode: 'direct', destination: 'provider-direct', dataLeaves: true }),
    ];
    const report = buildConfidentialityReport(entries, { matterId: MATTER_ID, matterName: MATTER_NAME, generatedAt: GENERATED_AT });
    expect(report.totalCalls).toBe(2);
    expect(report.anyDataLeftMachine).toBe(true);
    expect(report.byMode['local-only']).toBe(1);
    expect(report.byMode['direct']).toBe(1);
    expect(report.attestation).toMatch(/local model/i);
    expect(report.attestation).toMatch(/your own API key/i);
    expect(report.attestation).not.toMatch(/nothing left this machine/i);
  });

  it('filters entries to the active matter by scope', () => {
    const entries: AuditEntry[] = [
      egressEntry({ matterId: MATTER_ID, mode: 'direct' }),
      // Different matter - should be excluded
      {
        id: 'other',
        timestamp: '2026-06-17T10:00:00Z',
        action: 'egress',
        description: 'egress',
        model: undefined,
        inputs: {},
        outputs: {},
        userDecision: 'auto',
        metadata: {
          provider: 'openai',
          mode: 'direct',
          destination: 'provider-direct',
          dataLeaves: true,
          scope: { kind: 'matter', matterId: 'matter_other', matterName: 'Smith v. Jones' },
        },
      },
    ];
    const report = buildConfidentialityReport(entries, { matterId: MATTER_ID, matterName: MATTER_NAME, generatedAt: GENERATED_AT });
    expect(report.totalCalls).toBe(1);
  });

  it('zero-calls fixture: returns totalCalls=0, attestation mentions no activity', () => {
    const report = buildConfidentialityReport([], { matterId: MATTER_ID, matterName: MATTER_NAME, generatedAt: GENERATED_AT });
    expect(report.totalCalls).toBe(0);
    expect(report.anyDataLeftMachine).toBe(false);
    expect(report.attestation).toMatch(/no AI activity/i);
  });
});
