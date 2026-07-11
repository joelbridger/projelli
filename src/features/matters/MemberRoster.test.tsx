import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseMatterHandle } from '@/platform/firm/contract';

const firmMatterId = parseMatterHandle(`mh2_${'R'.repeat(43)}`);
const testState = vi.hoisted(() => {
  const mocks = {
    keyRelease: 'release_to_member' as 'release_to_member' | 'blocked_walled',
    publishMatterKeyToMembers: vi.fn(),
    append: vi.fn(),
  };
  const client = {
    listMatterMembers: vi.fn(() => Promise.resolve({ key_epoch: 4, members: [], walls: [] })),
    createUser: vi.fn(() => Promise.resolve({ user: { user_id: 'new-member' } })),
    addMatterMember: vi.fn(() => Promise.resolve({ ok: true, role: 'editor', key_epoch: 4, key_release: mocks.keyRelease })),
    removeMatterMember: vi.fn(),
  };
  return { client, getClient: () => client, mocks };
});
const { client, mocks } = testState;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: <T,>(selector: (state: { client: () => typeof testState.client; seatToken: string }) => T) => selector({
    client: testState.getClient,
    seatToken: 'seat-token',
  }),
}));
vi.mock('@/platform/firm/matterKeyService', () => ({ publishMatterKeyToMembers: testState.mocks.publishMatterKeyToMembers }));
vi.mock('./matterManagerDialogHelpers', () => ({
  generateTempPassword: () => 'temporary-password',
  audit: { append: testState.mocks.append },
}));

import { MemberRoster } from './MemberRoster';

describe('MemberRoster invite key release', () => {
  it('publishes only for an invite the server says may receive the key', async () => {
    mocks.publishMatterKeyToMembers.mockReset();
    client.addMatterMember.mockClear();
    mocks.keyRelease = 'release_to_member';
    render(<MemberRoster matterId="local-matter" firmMatterId={firmMatterId} canInvite />);

    await screen.findByTestId('firm-member-list-local-matter');
    fireEvent.change(screen.getByTestId('firm-invite-email-local-matter'), { target: { value: 'release@firm.test' } });
    fireEvent.click(screen.getByTestId('firm-invite-submit-local-matter'));
    await waitFor(() => expect(mocks.publishMatterKeyToMembers).toHaveBeenCalledWith(client, firmMatterId, 4));
  });

  it('does not publish for a walled invite', async () => {
    mocks.publishMatterKeyToMembers.mockReset();
    client.addMatterMember.mockClear();
    mocks.keyRelease = 'blocked_walled';
    render(<MemberRoster matterId="local-walled" firmMatterId={firmMatterId} canInvite />);

    await screen.findByTestId('firm-member-list-local-walled');
    fireEvent.change(screen.getByTestId('firm-invite-email-local-walled'), { target: { value: 'walled@firm.test' } });
    fireEvent.click(screen.getByTestId('firm-invite-submit-local-walled'));
    await waitFor(() => expect(client.addMatterMember).toHaveBeenCalledTimes(1));
    expect(mocks.publishMatterKeyToMembers).not.toHaveBeenCalled();
  });
});
