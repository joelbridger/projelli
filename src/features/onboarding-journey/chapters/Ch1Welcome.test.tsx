/// <reference types="@testing-library/jest-dom" />

/**
 * Ch1Welcome tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';
import { ch1Welcome } from './Ch1Welcome';

function makeCtx(overrides: Partial<ChapterContext> = {}): ChapterContext {
  return {
    advance: vi.fn(),
    goBack: vi.fn(),
    skipAll: vi.fn(),
    complete: vi.fn(),
    setData: vi.fn(),
    data: {} as JourneyData,
    reducedMotion: true,
    actions: {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      setConfidentialityMode: vi.fn(),
      chooseWorkspaceFolder: vi.fn().mockResolvedValue('/tmp/ws'),
    },
    ...overrides,
  };
}

describe('ch1Welcome — metadata', () => {
  it('has id "welcome"', () => {
    expect(ch1Welcome.id).toBe('welcome');
  });

  it('has title "Welcome"', () => {
    expect(ch1Welcome.title).toBe('Welcome');
  });
});

describe('ch1Welcome — render', () => {
  it('renders the welcome title', () => {
    const ctx = makeCtx();
    render(ch1Welcome.render(ctx));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Welcome to Keepance');
  });

  it('renders the body copy', () => {
    const ctx = makeCtx();
    render(ch1Welcome.render(ctx));
    expect(screen.getByText(/A private workroom/i)).toBeInTheDocument();
  });

  it('renders a Start button', () => {
    const ctx = makeCtx();
    render(ch1Welcome.render(ctx));
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('calls ctx.advance when Start is clicked', () => {
    const ctx = makeCtx();
    render(ch1Welcome.render(ctx));
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(ctx.advance).toHaveBeenCalledOnce();
  });

  it('does NOT render a Back button', () => {
    const ctx = makeCtx();
    render(ch1Welcome.render(ctx));
    expect(screen.queryByTestId('chapter-back')).not.toBeInTheDocument();
  });
});
