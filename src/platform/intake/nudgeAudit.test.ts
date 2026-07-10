import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('intake nudge audit app wiring', () => {
  it('registers the live App audit emitter for intake nudges', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(appSource).toContain("import { setIntakeNudgeAuditEmitter } from '@/platform/intake/nudgeAudit';");
    expect(appSource).toContain('setIntakeNudgeAuditEmitter(emitAuditEntry);');
    expect(appSource).toContain('setIntakeNudgeAuditEmitter(null);');
  });
});
