import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdfPreviewBeforeSend } from '@/features/ask/chat/PdfPreviewBeforeSend';

const SHORT_TEXT = 'This is extracted text from the PDF document.';
const LONG_TEXT = 'A'.repeat(300);

describe('PdfPreviewBeforeSend — text preview', () => {
  it('renders the first 200 chars of extracted text', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="report.pdf"
        extractedText={LONG_TEXT}
        pageCount={5}
        scanned={false}
        encrypted={false}
        mode="text-extract"
      />
    );
    const preview = screen.getByTestId('pdf-text-preview');
    expect(preview.textContent).toBe(LONG_TEXT.slice(0, 200) + '…');
  });

  it('renders full text when shorter than 200 chars (no ellipsis)', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="short.pdf"
        extractedText={SHORT_TEXT}
        pageCount={1}
        scanned={false}
        encrypted={false}
        mode="text-extract"
      />
    );
    const preview = screen.getByTestId('pdf-text-preview');
    expect(preview.textContent).toBe(SHORT_TEXT);
  });

  it('shows the file name', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="my-report.pdf"
        extractedText={SHORT_TEXT}
        pageCount={2}
        scanned={false}
        encrypted={false}
        mode="native"
      />
    );
    expect(screen.getByTestId('pdf-preview-filename').textContent).toContain('my-report.pdf');
  });

  it('shows the page count', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="doc.pdf"
        extractedText={SHORT_TEXT}
        pageCount={7}
        scanned={false}
        encrypted={false}
        mode="text-extract"
      />
    );
    expect(screen.getByTestId('pdf-preview-pages').textContent).toContain('7');
  });
});

describe('PdfPreviewBeforeSend — scanned PDF warning', () => {
  it('shows scanned warning when scanned=true', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="scan.pdf"
        extractedText=""
        pageCount={3}
        scanned={true}
        encrypted={false}
        mode="text-extract"
      />
    );
    expect(screen.getByTestId('pdf-scanned-warning')).toBeTruthy();
  });

  it('hides scanned warning when scanned=false', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="text.pdf"
        extractedText={SHORT_TEXT}
        pageCount={1}
        scanned={false}
        encrypted={false}
        mode="text-extract"
      />
    );
    expect(screen.queryByTestId('pdf-scanned-warning')).toBeNull();
  });

  it('shows native-escape-hatch button when scanned=true and mode=native', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="scan.pdf"
        extractedText=""
        pageCount={1}
        scanned={true}
        encrypted={false}
        mode="native"
      />
    );
    expect(screen.getByTestId('pdf-native-escape-hatch')).toBeTruthy();
  });

  it('hides native-escape-hatch when mode=text-extract', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="scan.pdf"
        extractedText=""
        pageCount={1}
        scanned={true}
        encrypted={false}
        mode="text-extract"
      />
    );
    expect(screen.queryByTestId('pdf-native-escape-hatch')).toBeNull();
  });
});

describe('PdfPreviewBeforeSend — encrypted PDF', () => {
  it('shows encrypted error and hides text preview', () => {
    render(
      <PdfPreviewBeforeSend
        fileName="secret.pdf"
        extractedText=""
        pageCount={0}
        scanned={false}
        encrypted={true}
        mode="text-extract"
      />
    );
    expect(screen.getByTestId('pdf-encrypted-error')).toBeTruthy();
    expect(screen.queryByTestId('pdf-text-preview')).toBeNull();
  });
});
