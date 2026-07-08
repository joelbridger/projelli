import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppLogo } from '@/ui/brand/AppLogo';
import { BRAND } from '@/config/brand';

describe('AppLogo', () => {
  it('uses the default brand logo when no variant is requested', () => {
    render(<AppLogo height={32} />);

    const logo = screen.getByRole('img', { name: BRAND.name });
    expect(logo).toHaveAttribute(
      'src',
      BRAND.assets.logo
    );
    expect(logo).toHaveStyle({ height: '32px' });
  });

  it('uses the dark full-color brand logo for the top bar variant', () => {
    render(<AppLogo height={32} variant="dark" />);

    expect(screen.getByRole('img', { name: BRAND.name })).toHaveAttribute(
      'src',
      BRAND.assets.logoDark
    );
  });
});
