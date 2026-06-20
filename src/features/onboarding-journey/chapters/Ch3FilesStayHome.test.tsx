/// <reference types="@testing-library/jest-dom" />

/**
 * Ch3FilesStayHome tests
 *
 * Key behaviors:
 * - Continue is gated: requires workspacePath set
 * - "Choose a folder" button calls ctx.actions.chooseWorkspaceFolder
 * - On a non-null return, calls ctx.setData({ workspacePath }) and shows the path
 * - Continue disabled before folder chosen; enabled after
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';
import { ch3FilesStayHome } from './Ch3FilesStayHome';

function makeCtx(data: JourneyData = {}, choosePath: string | null = null): ChapterContext {
  return {
    advance: vi.fn(),
    goBack: vi.fn(),
    skipAll: vi.fn(),
    complete: vi.fn(),
    setData: vi.fn(),
    data,
    reducedMotion: true,
    actions: {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      setConfidentialityMode: vi.fn(),
      chooseWorkspaceFolder: vi.fn().mockResolvedValue(choosePath),
    },
  };
}

describe('ch3FilesStayHome — metadata', () => {
  it('has id "files-home"', () => {
    expect(ch3FilesStayHome.id).toBe('files-home');
  });

  it('has title "Your files"', () => {
    expect(ch3FilesStayHome.title).toBe('Your files');
  });
});

describe('ch3FilesStayHome — canAdvance gate', () => {
  it('returns false when workspacePath is not set', () => {
    expect(ch3FilesStayHome.canAdvance?.({})).toBe(false);
  });

  it('returns true when workspacePath is set', () => {
    expect(ch3FilesStayHome.canAdvance?.({ workspacePath: '/home/user/keepance' })).toBe(true);
  });
});

describe('ch3FilesStayHome — render & interaction', () => {
  it('renders the title', () => {
    render(ch3FilesStayHome.render(makeCtx()));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Your files stay home');
  });

  it('renders a "Choose a folder" button', () => {
    render(ch3FilesStayHome.render(makeCtx()));
    expect(screen.getByRole('button', { name: /choose a folder/i })).toBeInTheDocument();
  });

  it('Continue is disabled before a folder is chosen', () => {
    render(ch3FilesStayHome.render(makeCtx()));
    expect(screen.getByTestId('chapter-continue')).toBeDisabled();
  });

  it('clicking "Choose a folder" calls ctx.actions.chooseWorkspaceFolder', async () => {
    const ctx = makeCtx({}, '/Users/alice/work');
    render(ch3FilesStayHome.render(ctx));
    fireEvent.click(screen.getByRole('button', { name: /choose a folder/i }));
    await waitFor(() => {
      expect(ctx.actions.chooseWorkspaceFolder).toHaveBeenCalledOnce();
    });
  });

  it('calls ctx.setData with the chosen path on non-null return', async () => {
    const ctx = makeCtx({}, '/Users/alice/work');
    render(ch3FilesStayHome.render(ctx));
    fireEvent.click(screen.getByRole('button', { name: /choose a folder/i }));
    await waitFor(() => {
      expect(ctx.setData).toHaveBeenCalledWith({ workspacePath: '/Users/alice/work' });
    });
  });

  it('shows the chosen path after selection', async () => {
    const ctx = makeCtx({}, '/Users/alice/work');
    render(ch3FilesStayHome.render(ctx));
    fireEvent.click(screen.getByRole('button', { name: /choose a folder/i }));
    await waitFor(() => {
      expect(screen.getByText('/Users/alice/work')).toBeInTheDocument();
    });
  });

  it('does not call setData when chooseWorkspaceFolder returns null (cancelled)', async () => {
    const ctx = makeCtx({}, null);
    render(ch3FilesStayHome.render(ctx));
    fireEvent.click(screen.getByRole('button', { name: /choose a folder/i }));
    await waitFor(() => {
      expect(ctx.actions.chooseWorkspaceFolder).toHaveBeenCalledOnce();
    });
    expect(ctx.setData).not.toHaveBeenCalled();
  });

  it('Continue is enabled when workspacePath is pre-set in data', () => {
    const ctx = makeCtx({ workspacePath: '/home/user/docs' });
    render(ch3FilesStayHome.render(ctx));
    expect(screen.getByTestId('chapter-continue')).not.toBeDisabled();
  });

  it('clicking Continue when gate passes calls ctx.advance', () => {
    const ctx = makeCtx({ workspacePath: '/home/user/docs' });
    render(ch3FilesStayHome.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(ctx.advance).toHaveBeenCalledOnce();
  });

  it('clicking Back calls ctx.goBack', () => {
    const ctx = makeCtx();
    render(ch3FilesStayHome.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-back'));
    expect(ctx.goBack).toHaveBeenCalledOnce();
  });

  it('shows the synced-folder note on initial render before any folder is chosen', () => {
    render(ch3FilesStayHome.render(makeCtx()));
    expect(screen.getByText(/A synced folder like Dropbox/i)).toBeInTheDocument();
  });
});
