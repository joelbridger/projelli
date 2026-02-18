import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '@/App';

describe('App', () => {
  it('renders the workspace selector dialog title', () => {
    render(<App />);
    expect(screen.getByText('Welcome to Business OS')).toBeInTheDocument();
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
