// VG-4a — LibreOfficeHelpNotice: the panel shown when the user asks for a
// PDF export and LibreOffice is not installed. Asserts the plain-language
// explanation renders (title + body + download link), the copy button writes
// the link to the clipboard and confirms, and dismiss fires the callback.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { brandText } from '@/config/brandText';
import { LibreOfficeHelpNotice } from '@/features/documents/media/LibreOfficeHelpNotice';

const DOWNLOAD_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

describe('LibreOfficeHelpNotice (VG-4a)', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    writeTextMock.mockReset().mockResolvedValue(undefined);
    // jsdom has no navigator.clipboard; install a observable stub.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  it('explains the missing dependency in plain language with the download link', () => {
    render(<LibreOfficeHelpNotice onDismiss={() => {}} />);

    const notice = screen.getByTestId('libreoffice-help-notice');
    expect(notice).toHaveTextContent('PDF export needs LibreOffice');
    expect(notice).toHaveTextContent(
      brandText(
        'Lantern converts Word to PDF locally using LibreOffice, a free program. ' +
          'Nothing leaves your machine. Install it, then run the export again.',
      ),
    );
    expect(notice).toHaveTextContent(DOWNLOAD_URL);
  });

  it('copy button writes the download URL to the clipboard and confirms', async () => {
    render(<LibreOfficeHelpNotice onDismiss={() => {}} />);

    const copyButton = screen.getByTestId('libreoffice-copy-link');
    expect(copyButton).toHaveTextContent('Copy link');
    fireEvent.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledWith(DOWNLOAD_URL);
    // The label flips to the copied confirmation once the write resolves.
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('dismiss fires onDismiss', () => {
    const onDismiss = vi.fn();
    render(<LibreOfficeHelpNotice onDismiss={onDismiss} />);

    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
