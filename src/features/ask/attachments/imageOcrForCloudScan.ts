import { isOcrEngineAvailable, ocrPageImage } from '@/platform/rag/ocr/ocrEngine';
import type { AttachmentBytes } from '@/platform/providers/Provider';

/**
 * Read image text locally before a cloud vision request. An unavailable or
 * failed OCR engine deliberately returns no text; prompt preparation then
 * blocks the image instead of sending bytes it could not inspect.
 */
export async function extractImageTextForCloudScan(
  attachment: AttachmentBytes,
): Promise<string | undefined> {
  if (attachment.att.type !== 'image' || !isOcrEngineAvailable()) return undefined;
  try {
    const result = await ocrPageImage(attachment.bytes);
    return result.text;
  } catch (error) {
    console.warn('[AIChat] Local OCR could not inspect image attachment; upload will be blocked.', error);
    return undefined;
  }
}
