/**
 * File utility functions for handling binary files, MIME types, and data URL conversion
 */

/**
 * Check if a file is a binary file based on its extension
 * @param name - The file name or path
 * @returns true if the file is binary, false otherwise
 */
export function isBinaryFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  const binaryExtensions = [
    // Images
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
    // Videos
    'mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg',
    // Audio
    'mp3', 'wav', 'm4a',
    // Documents
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    // Archives
    'zip', 'rar', '7z', 'tar', 'gz',
  ];
  return binaryExtensions.includes(ext);
}

/**
 * Convert an ArrayBuffer to a data URL
 * @param buffer - The ArrayBuffer to convert
 * @param mimeType - The MIME type of the data
 * @returns A data URL string
 */
export function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * Get MIME type from file extension
 * @param name - The file name or path
 * @returns The MIME type string
 */
export function getMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    // Videos
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    ogg: 'video/ogg',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
  };
  return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
}
