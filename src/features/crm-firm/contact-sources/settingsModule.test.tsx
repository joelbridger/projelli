import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createContactSourceCatalogStore } from './catalog';
import { ContactSourcesSettings } from './settingsModule';
import { contactSourcesSettingsPanel } from './settingsModuleDescriptor';

describe('ContactSourcesSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mounts once as a dark Organization settings panel', () => {
    expect(contactSourcesSettingsPanel).toEqual(
      expect.objectContaining({
        id: 'contact-sources',
        section: 'organization',
        flagId: 'contact-sources',
      })
    );
  });

  it('lets a firm add, rename, reorder, deactivate, reactivate, and safely retire a source', () => {
    const store = createContactSourceCatalogStore();
    render(<ContactSourcesSettings store={store} />);

    fireEvent.change(screen.getByTestId('contact-source-new'), {
      target: { value: 'Website' },
    });
    fireEvent.click(screen.getByTestId('contact-source-add'));
    expect(
      screen.getByTestId('contact-source-row-website')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('contact-source-label-referral'), {
      target: { value: 'Professional referral' },
    });
    fireEvent.click(screen.getByTestId('contact-source-save-referral'));
    expect(screen.getByTestId('contact-source-label-referral')).toHaveValue(
      'Professional referral'
    );

    fireEvent.click(screen.getByLabelText('Move Website up'));
    expect(store.load().sources.map((source) => source.id)).toEqual([
      'website',
      'referral',
    ]);

    fireEvent.click(screen.getByTestId('contact-source-toggle-website'));
    expect(
      screen.getByTestId('contact-source-status-website')
    ).toHaveTextContent('Inactive');
    fireEvent.click(screen.getByTestId('contact-source-toggle-website'));
    expect(
      screen.getByTestId('contact-source-status-website')
    ).toHaveTextContent('Active');

    fireEvent.click(screen.getByTestId('contact-source-retire-referral'));
    expect(
      screen.getByTestId('contact-source-confirm-retire-referral')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('contact-source-confirm-retire-referral')
    );
    expect(
      screen.getByTestId('contact-source-status-referral')
    ).toHaveTextContent('Retired');
  });
});
