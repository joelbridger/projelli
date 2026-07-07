import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders the shared Ask-style pill size class', () => {
    render(<Chip size="pill">All clients</Chip>);

    expect(screen.getByRole('button', { name: 'All clients' }).className).toContain('kp-chip--pill');
  });
});
