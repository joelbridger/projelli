import type { FSBackend } from '@/modules/workspace/types';
import type { ChatAttachment } from '@/types/ai';
import { sha256Hex } from '@/lib/hash';

const SUPPORTED_MIME: Record<string, ChatAttachment['type']> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export class AttachmentService {
  constructor(
    private fs: FSBackend,
    private monthFn: () => string = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
  ) {}

  async save(
    bytes: Uint8Array,
    fileName: string,
    mimeType: string
  ): Promise<ChatAttachment> {
    const type = SUPPORTED_MIME[mimeType];
    if (!type) {
      throw new Error(`Unsupported MIME type: ${mimeType}`);
    }
    const hash = await sha256Hex(bytes);
    const ext = EXT_BY_MIME[mimeType];
    const month = this.monthFn();
    const pathInWorkspace = `media/${month}/chat-${type}-${hash}.${ext}`;

    await this.fs.mkdir(`media/${month}`).catch(() => {});
    // FSBackend uses writeBinary(path, ArrayBuffer)
    await this.fs.writeBinary(pathInWorkspace, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

    return {
      id: hash,
      type,
      mimeType,
      fileName,
      pathInWorkspace,
      byteSize: bytes.byteLength,
      metadata: {},
    };
  }

  async read(att: ChatAttachment): Promise<Uint8Array> {
    const buf = await this.fs.readBinary(att.pathInWorkspace);
    return new Uint8Array(buf);
  }

  async delete(att: ChatAttachment): Promise<void> {
    await this.fs.delete(att.pathInWorkspace);
  }

  async exists(att: ChatAttachment): Promise<boolean> {
    return await this.fs.exists(att.pathInWorkspace);
  }
}
