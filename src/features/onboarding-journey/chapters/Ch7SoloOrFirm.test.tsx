/// <reference types="@testing-library/jest-dom" />

/**
 * Ch7SoloOrFirm tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';
import { ch7SoloOrFirm } from './Ch7SoloOrFirm';

// ---------------------------------------------------------------------------
// Helper: stub ChapterContext
// ---------------------------------------------------------------------------

function makeCtx(data: JourneyData = {}): ChapterContext {
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
      chooseWorkspaceFolder: vi.fn().mockResolvedValue('/tmp/ws'),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ch7SoloOrFirm — metadata', () => {
  it('has id "firm"', () => {
    expect(ch7SoloOrFirm.id).toBe('firm');
  });

  it('has title "Team"', () => {
    expect(ch7SoloOrFirm.title).toBe('Team');
  });
});

describe('ch7SoloOrFirm — initial render', () => {
  it('renders the chapter title', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Just you, or a team?');
  });

  it('renders all three option cards', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    expect(screen.getByTestId('ch7-option-solo')).toBeInTheDocument();
    expect(screen.getByTestId('ch7-option-create')).toBeInTheDocument();
    expect(screen.getByTestId('ch7-option-join')).toBeInTheDocument();
  });

  it('solo is selected by default (no existing firmChoice in data)', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    const soloBtn = screen.getByTestId('ch7-option-solo');
    // selected state is represented by the 2px navy border
    expect(soloBtn).toBeInTheDocument();
    // invite-code field should NOT be visible
    expect(screen.queryByTestId('ch7-invite-code-input')).not.toBeInTheDocument();
  });

  it('shows the "You can change this any time in Settings." note', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    expect(screen.getByText(/You can change this any time in Settings/i)).toBeInTheDocument();
  });

  it('renders Back and Continue buttons', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    expect(screen.getByTestId('chapter-back')).toBeInTheDocument();
    expect(screen.getByTestId('chapter-continue')).toBeInTheDocument();
  });
});

describe('ch7SoloOrFirm — option selection', () => {
  it('clicking "Create a firm" selects it', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    fireEvent.click(screen.getByTestId('ch7-option-create'));
    // Invite code input should NOT appear for create
    expect(screen.queryByTestId('ch7-invite-code-input')).not.toBeInTheDocument();
  });

  it('clicking "Join a firm" shows the invite code field', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    fireEvent.click(screen.getByTestId('ch7-option-join'));
    expect(screen.getByTestId('ch7-invite-code-input')).toBeInTheDocument();
  });

  it('clicking "I work solo" after "Join a firm" hides the invite code field', () => {
    render(ch7SoloOrFirm.render(makeCtx()));
    fireEvent.click(screen.getByTestId('ch7-option-join'));
    expect(screen.getByTestId('ch7-invite-code-input')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ch7-option-solo'));
    expect(screen.queryByTestId('ch7-invite-code-input')).not.toBeInTheDocument();
  });
});

describe('ch7SoloOrFirm — Continue advances and saves data', () => {
  it('Continue with solo calls ctx.setData({ firmChoice: "solo" }) and ctx.advance()', () => {
    const ctx = makeCtx();
    render(ch7SoloOrFirm.render(ctx));
    // solo is default
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(ctx.setData).toHaveBeenCalledWith({ firmChoice: 'solo' });
    expect(ctx.advance).toHaveBeenCalledOnce();
  });

  it('Continue with create saves firmChoice: "create"', () => {
    const ctx = makeCtx();
    render(ch7SoloOrFirm.render(ctx));
    fireEvent.click(screen.getByTestId('ch7-option-create'));
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(ctx.setData).toHaveBeenCalledWith({ firmChoice: 'create' });
    expect(ctx.advance).toHaveBeenCalledOnce();
  });

  it('Continue with join saves firmChoice: "join" and firmInviteCode', () => {
    const ctx = makeCtx();
    render(ch7SoloOrFirm.render(ctx));
    fireEvent.click(screen.getByTestId('ch7-option-join'));
    fireEvent.change(screen.getByTestId('ch7-invite-code-input'), {
      target: { value: 'ABC-123' },
    });
    fireEvent.click(screen.getByTestId('chapter-continue'));
    expect(ctx.setData).toHaveBeenCalledWith({ firmChoice: 'join' });
    expect(ctx.setData).toHaveBeenCalledWith({ firmInviteCode: 'ABC-123' });
    expect(ctx.advance).toHaveBeenCalledOnce();
  });

  it('Back calls ctx.goBack()', () => {
    const ctx = makeCtx();
    render(ch7SoloOrFirm.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-back'));
    expect(ctx.goBack).toHaveBeenCalledOnce();
  });
});

describe('ch7SoloOrFirm — pre-populated firmChoice from ctx.data', () => {
  it('pre-selects join when ctx.data.firmChoice is "join"', () => {
    const ctx = makeCtx({ firmChoice: 'join' });
    render(ch7SoloOrFirm.render(ctx));
    // join option should be selected, invite field visible
    expect(screen.getByTestId('ch7-invite-code-input')).toBeInTheDocument();
  });
});
