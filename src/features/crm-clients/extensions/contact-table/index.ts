import { createElement } from 'react';
import { isEnabled } from '@/platform/flags';
import type {
  DirectoryContribution,
  DirectoryViewDescriptor,
} from '@/features/crm-clients';
import { ContactTableDirectoryView } from './contactTableView';

declare module '@/features/crm-clients' {
  interface DirectoryViewIdMap {
    'crm-contact-table': true;
  }
}

const contactTableView: DirectoryViewDescriptor<'crm-contact-table'> = {
  id: 'crm-contact-table',
  order: 100,
  replaces: ['directory'],
  isActive: (context) => {
    if (!isEnabled('crm-contact-table')) return false;
    return context.view.value !== 'book';
  },
  mount: (context) => createElement(ContactTableDirectoryView, { context }),
};

/** Minimal public contribution. The application coordinator supplies it to directory composition. */
export const contactTableDirectoryContribution: DirectoryContribution = {
  views: [contactTableView],
};
