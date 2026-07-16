import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

const { useFlag, useLiveCrmRecords } = vi.hoisted(() => ({
  useFlag: vi.fn(),
  useLiveCrmRecords: vi.fn(),
}));

vi.mock('@/platform/flags', () => ({ useFlag }));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({ useLiveCrmRecords }));
// Cross-feature mock uses the public doorway, never a deep implementation path.
vi.mock('@/features/crm-activity', () => ({ CrmActivitySurface: () => <div data-testid="legacy-activity-surface" /> }));

import { TeamActivitySurface } from './TeamActivitySurface';

describe('TeamActivitySurface flag gate', () => {
  it('is inert while off and mounts the exact legacy Activity surface', () => {
    useFlag.mockReturnValue(false);
    render(<TeamActivitySurface />);
    expect(screen.getByTestId('legacy-activity-surface')).toBeInTheDocument();
    expect(useLiveCrmRecords).not.toHaveBeenCalled();
  });

  it('starts the enabled feed only when the flag is on', () => {
    useFlag.mockReturnValue(true);
    useLiveCrmRecords.mockReturnValue({ records: [], save: vi.fn(), reload: vi.fn(), error: null, workspaceRoot: '/tmp/test', sharedMatterId: 'firm_home' });
    render(<TeamActivitySurface />);
    expect(screen.getByTestId('team-activity-feed')).toBeInTheDocument();
    expect(useLiveCrmRecords).toHaveBeenCalledTimes(1);
  });
});
