import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInputToolbar } from '@/features/ask/chat/ChatInputToolbar';
import type { ChatAttachment } from '@/platform/types/ai';

const att: ChatAttachment = {
  id: 'hash1',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-hash1.png',
  byteSize: 1024,
  metadata: {},
};

function renderToolbar(overrides: Partial<React.ComponentProps<typeof ChatInputToolbar>> = {}) {
  const defaults = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    pendingAttachments: [],
    previewUrls: {},
    onFilesSelected: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSwitchModel: vi.fn(),
    visionWarning: null,
    sendDisabled: false,
  };
  return render(<ChatInputToolbar {...defaults} {...overrides} />);
}

describe('ChatInputToolbar', () => {
  it('renders the paperclip button', () => {
    renderToolbar();
    expect(screen.getByTestId('chat-paperclip-button')).toBeTruthy();
  });

  it('shows attachment tile for each pending attachment', () => {
    renderToolbar({ pendingAttachments: [att] });
    expect(screen.getByTestId(`attachment-tile-${att.id}`)).toBeTruthy();
  });

  it('calls onRemoveAttachment when remove button clicked', () => {
    const onRemove = vi.fn();
    renderToolbar({ pendingAttachments: [att], onRemoveAttachment: onRemove });
    fireEvent.click(screen.getByTestId(`attachment-remove-${att.id}`));
    expect(onRemove).toHaveBeenCalledWith(att.id);
  });

  it('shows VisionWarningBanner when visionWarning is set', () => {
    renderToolbar({ visionWarning: 'Model X does not support images.', pendingAttachments: [att] });
    expect(screen.getByTestId('vision-warning-banner')).toBeTruthy();
  });

  it('does not show VisionWarningBanner when visionWarning is null', () => {
    renderToolbar({ visionWarning: null });
    expect(screen.queryByTestId('vision-warning-banner')).toBeNull();
  });

  it('shows drag overlay on dragover', () => {
    renderToolbar();
    const toolbar = screen.getByTestId('chat-input-toolbar');
    fireEvent.dragOver(toolbar);
    expect(screen.getByTestId('chat-drop-overlay')).toBeTruthy();
  });

  it('calls onFilesSelected when valid file dropped', () => {
    const onFiles = vi.fn();
    renderToolbar({ onFilesSelected: onFiles });
    const toolbar = screen.getByTestId('chat-input-toolbar');
    const file = new File(['data'], 'image.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 1024 });
    fireEvent.drop(toolbar, {
      dataTransfer: { files: [file] },
    });
    expect(onFiles).toHaveBeenCalled();
  });

  it('calls onFilesSelected with pasted image', () => {
    const onFiles = vi.fn();
    renderToolbar({ onFilesSelected: onFiles });
    const toolbar = screen.getByTestId('chat-input-toolbar');
    const file = new File(['data'], 'pasted.png', { type: 'image/png' });
    const dt = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    };
    fireEvent.paste(toolbar, { clipboardData: dt });
    expect(onFiles).toHaveBeenCalled();
  });
});
