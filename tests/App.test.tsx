import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '@/App';

describe('App', () => {
  it('renders the workspace selector welcome pitch', () => {
    render(<App />);
    // v1.0.8 branded start screen replaced the "Welcome to Business OS"
    // heading with the Keepance SVG wordmark + a pitch line. Assert on
    // the pitch data-testid so this doesn't re-break on future copy tweaks.
    expect(screen.getByTestId('welcome-dialog-pitch')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-dialog-pitch').textContent).toMatch(
      /Your practice folder/i,
    );
  });

  it('renders the Open Existing button', () => {
    render(<App />);
    expect(screen.getByText('Open Existing')).toBeInTheDocument();
  });

  it('renders the New Workspace button', () => {
    render(<App />);
    expect(screen.getByText('New Workspace')).toBeInTheDocument();
  });
});
