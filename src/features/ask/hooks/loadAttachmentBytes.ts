// loadAttachmentBytes — read raw bytes for each attachment that will actually
// be sent, so the provider can build its image/PDF content blocks.
//
// Extracted VERBATIM from useChatSending. Stream A1: attachments are stored on
// disk; we read them now so the async I/O is done before we hand off to the
// provider. Any attachment that fails to read is skipped gracefully (logged but
// not fatal). The caller only ever passes `sentAttachments` (unconsented
// exports were already excluded), so withheld files' bytes are never read.

import { AttachmentService } from '@/features/ask/attachments/AttachmentService';
import type { FSBackend } from '@/platform/fs/types';
import type { ChatAttachment } from '@/platform/types/ai';
import type { AttachmentBytes } from '@/platform/providers/Provider';

export async function loadAttachmentBytes(
  sentAttachments: ChatAttachment[] | undefined,
  backend: FSBackend | null,
): Promise<AttachmentBytes[] | undefined> {
  if (!sentAttachments || sentAttachments.length === 0 || !backend) return undefined;
  const attService = new AttachmentService(backend);
  const loaded: AttachmentBytes[] = [];
  for (const att of sentAttachments) {
    try {
      const bytes = await attService.read(att);
      loaded.push({ att, bytes });
    } catch (readErr) {
      console.error(
        `[AIChat] Failed to read attachment bytes for ${att.fileName}:`,
        readErr,
      );
    }
  }
  return loaded.length > 0 ? loaded : undefined;
}
