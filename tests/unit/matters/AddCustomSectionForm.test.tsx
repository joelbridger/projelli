// tests/unit/matters/AddCustomSectionForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddCustomSectionForm } from '@/features/matters/AddCustomSectionForm';

vi.mock('@/features/matters/clientMap/customSection', () => ({
  buildCustomSection: vi.fn().mockResolvedValue({ id: 'x', kind: 'custom', key: 'x', title: 'T', scope: 'matter', items: [] }),
}));
vi.mock('@/platform/clientMap/clientMapStore', () => ({
  useClientMapStore: () => ({
    addCustomSection: vi.fn(),
    getMap: vi.fn().mockReturnValue(undefined),
  }),
}));

describe('AddCustomSectionForm', () => {
  it('renders title and description inputs and a submit button', () => {
    render(<AddCustomSectionForm matterId="m1" onAdded={vi.fn()} />);
    expect(screen.getByTestId('custom-section-title')).toBeInTheDocument();
    expect(screen.getByTestId('custom-section-description')).toBeInTheDocument();
    expect(screen.getByTestId('custom-section-submit')).toBeInTheDocument();
  });

  it('submit button is disabled when title is empty', () => {
    render(<AddCustomSectionForm matterId="m1" onAdded={vi.fn()} />);
    expect(screen.getByTestId('custom-section-submit')).toBeDisabled();
  });

  it('submit button is enabled when title is filled', () => {
    render(<AddCustomSectionForm matterId="m1" onAdded={vi.fn()} />);
    fireEvent.change(screen.getByTestId('custom-section-title'), { target: { value: 'Insurance' } });
    expect(screen.getByTestId('custom-section-submit')).not.toBeDisabled();
  });
});
