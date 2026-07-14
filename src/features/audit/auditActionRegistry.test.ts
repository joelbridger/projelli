import { describe, expect, it } from 'vitest';
import {
  auditActionRegistry,
  auditActionLocaleKeyExists,
  getAuditActionDescriptor,
  validateAuditActionDescriptors,
} from './auditActionRegistry';

describe('auditActionRegistry', () => {
  it('is the sole source for every audit-home display descriptor', () => {
    expect(auditActionRegistry).not.toHaveLength(0);
    for (const descriptor of auditActionRegistry) {
      expect(getAuditActionDescriptor(descriptor.id)).toBe(descriptor);
    }
    expect(() => {
      validateAuditActionDescriptors(
        auditActionRegistry,
        auditActionLocaleKeyExists
      );
    }).not.toThrow();
  });

  it('rejects duplicate public action ids', () => {
    const first = auditActionRegistry.at(0);
    if (!first) throw new Error('Expected a legacy audit action descriptor');
    expect(() => {
      validateAuditActionDescriptors(
        [first, { ...first }],
        auditActionLocaleKeyExists
      );
    }).toThrow(`duplicate audit action id: ${first.id}`);
  });

  it('rejects an unresolved descriptor locale key', () => {
    const first = auditActionRegistry.at(0);
    if (!first) throw new Error('Expected a legacy audit action descriptor');
    expect(() => {
      validateAuditActionDescriptors(
        [{ ...first, labelKey: 'audit.actions.missing' }],
        auditActionLocaleKeyExists
      );
    }).toThrow('unresolved locale key: audit.actions.missing');
  });
});
