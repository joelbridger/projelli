import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'src/features/calendar/core');

describe('calendar foundation boundaries and paved path', () => {
  it('documents the public imports, one-line projection append, scheduling mount, tests, and parked provider boundary', () => {
    const skill = readFileSync(resolve(root, 'SKILL.md'), 'utf8');
    expect(skill).toContain("from '@/features/calendar'");
    expect(skill).toContain('@/features/calendar/testing');
    expect(skill).toContain('docs/skills/add-scheduling-contribution/SKILL.md');
    expect(skill).toContain('  myReadOnlyProjection,');
    expect(skill).toContain("source: 'external-read-only'");
    expect(skill).toContain('writes, moves, deletes, holds, and confirmations do not belong');
    expect(skill).toContain('tests/public-imports/calendar-foundation.compile.test.ts');
  });

  it('has no provider, native, browser-store, egress, writer, receipt, or flag implementation', () => {
    const implementation = readdirSync(root)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(resolve(root, name), 'utf8'))
      .join('\n');
    expect(implementation).not.toContain("from '@tauri-apps/api");
    expect(implementation).not.toContain('localStorage');
    expect(implementation).not.toContain('useSchedulingStore');
    expect(implementation).not.toContain('saveLiveCrmRecord');
    expect(implementation).not.toContain('defineFlag(');
    expect(implementation).not.toContain('calendarConnectOutlook');
    expect(implementation).not.toContain('calendarConnectGoogle');
    expect(implementation).not.toContain('prepareProviderWrite');
    expect(implementation).not.toContain('verifiedReceipt');
  });

  it('leaves the booking page presentation-only with no calendar-domain import', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/features/booking/public-page/BookingPublicPage.tsx'), 'utf8');
    expect(page).not.toContain('@/features/calendar');
    expect(page).not.toContain('useLiveCrmRecords');
    expect(page).not.toContain('saveLiveCrmRecord');
    expect(page).not.toContain('calendarListEvents');
  });
});
