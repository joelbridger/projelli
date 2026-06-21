/// <reference types="@testing-library/jest-dom" />

/**
 * Ch4MeetTheAI tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChapterContext, JourneyData } from '../engine/types';
import { ch4MeetTheAI } from './Ch4MeetTheAI';

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

describe('ch4MeetTheAI — metadata', () => {
  it('has id "meet-ai"', () => {
    expect(ch4MeetTheAI.id).toBe('meet-ai');
  });

  it('has title "Meet the AI"', () => {
    expect(ch4MeetTheAI.title).toBe('Meet the AI');
  });
});

describe('ch4MeetTheAI — render', () => {
  it('renders the title', () => {
    render(ch4MeetTheAI.render(makeCtx()));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Meet the AI');
  });

  it('renders body copy about plugging in a brain', () => {
    render(ch4MeetTheAI.render(makeCtx()));
    expect(screen.getByText(/Think of AI as a brain you plug in/i)).toBeInTheDocument();
  });

  it('renders body copy about showing receipts', () => {
    render(ch4MeetTheAI.render(makeCtx()));
    expect(screen.getByText(/shows its receipts/i)).toBeInTheDocument();
  });

  it('renders a "Show me my choices" button', () => {
    render(ch4MeetTheAI.render(makeCtx()));
    expect(screen.getByRole('button', { name: /show me my choices/i })).toBeInTheDocument();
  });

  it('clicking "Show me my choices" calls ctx.advance', () => {
    const ctx = makeCtx();
    render(ch4MeetTheAI.render(ctx));
    fireEvent.click(screen.getByRole('button', { name: /show me my choices/i }));
    expect(ctx.advance).toHaveBeenCalledOnce();
  });

  it('clicking Back calls ctx.goBack', () => {
    const ctx = makeCtx();
    render(ch4MeetTheAI.render(ctx));
    fireEvent.click(screen.getByTestId('chapter-back'));
    expect(ctx.goBack).toHaveBeenCalledOnce();
  });
});
