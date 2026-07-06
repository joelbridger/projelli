import { describe, it, expect, vi } from 'vitest';
import { applyTitleStatus } from './tauriDriver';

/** Minimal spy shaped like the supervisor's driver-event surface. */
function fakeSupervisor() {
  return {
    handleLobby: vi.fn(),
    handleAdmitted: vi.fn(),
    handlePresumedPresent: vi.fn(),
    handleDenied: vi.fn(),
    handleDisconnected: vi.fn(),
    handleFailed: vi.fn(),
  };
}

describe('applyTitleStatus', () => {
  it('routes each status token to the matching supervisor handler', () => {
    const cases: Array<[string, keyof ReturnType<typeof fakeSupervisor>]> = [
      ['NC:lobby', 'handleLobby'],
      ['NC:admitted', 'handleAdmitted'],
      ['NC:present-unknown', 'handlePresumedPresent'],
      ['NC:denied', 'handleDenied'],
      ['NC:disconnected', 'handleDisconnected'],
    ];
    for (const [title, handler] of cases) {
      const sup = fakeSupervisor();
      applyTitleStatus(sup, title);
      expect(sup[handler], `${title} -> ${handler}`).toHaveBeenCalledTimes(1);
    }
  });

  it('maps page-drift (unrecognized) to a page-unrecognized failure', () => {
    const sup = fakeSupervisor();
    applyTitleStatus(sup, 'NC:unrecognized');
    expect(sup.handleFailed).toHaveBeenCalledWith('page-unrecognized');
  });

  it('treats a vanished window (null title) as a disconnect', () => {
    const sup = fakeSupervisor();
    applyTitleStatus(sup, null);
    expect(sup.handleDisconnected).toHaveBeenCalledTimes(1);
  });

  it('ignores the transient "joining" token and any non-ours title', () => {
    const sup = fakeSupervisor();
    applyTitleStatus(sup, 'NC:joining');
    applyTitleStatus(sup, 'Some Meeting - Microsoft Teams');
    for (const fn of Object.values(sup)) expect(fn).not.toHaveBeenCalled();
  });
});
