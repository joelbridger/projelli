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
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Extensions that are ALWAYS binary. This set is the single source of truth that
 * decides whether Advisor Prep Hero handles a file as raw bytes (data-URL / binary read &
 * write) instead of UTF-8 text. Treating a real binary file as text corrupts it
 * on import, on save/autosave, and (before BUG-034) on download — so this list
 * must err on the side of "binary". Every entry here is a format that is never
 * plain text; we deliberately DO NOT add ambiguous formats that can be text
 * (e.g. .csv, .eps, .ps, .stl, .obj, .dxf, .svg-as-source) so a genuine text
 * file is never misread as binary.
 *
 * NOTE: extension matching is a heuristic. The robust long-term fix is to sniff
 * the file's magic bytes rather than trust the extension (tracked as BUG-035).
 */
const BINARY_EXTENSIONS = new Set<string>([
  // Images (svg is intentionally kept here for backwards compatibility even
  // though it is XML text — changing that is out of scope for the byte fix).
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
  'tiff', 'tif', 'heic', 'heif', 'avif', 'jfif', 'psd',
  'raw', 'cr2', 'nef', 'arw', 'dng',
  // Videos
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg', 'ogv',
  'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp', 'm2ts', 'mts',
  // Audio
  'mp3', 'wav', 'm4a', 'flac', 'aac', 'oga', 'opus', 'weba',
  'wma', 'aiff', 'aif', 'mid', 'midi', 'amr',
  // Documents (binary or ZIP-container office formats)
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf',
  'odt', 'ods', 'odp', 'pages', 'numbers', 'key',
  'epub', 'mobi', 'azw', 'azw3', 'vsd', 'vsdx', 'one', 'pub', 'wpd',
  // Archives / compression
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'zstd',
  'lz', 'lzma', 'cab', 'tgz', 'tbz', 'tbz2', 'iso', 'dmg', 'jar', 'war',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Executables / native binaries
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class',
  'msi', 'deb', 'rpm', 'apk', 'appimage', 'node',
  // Data / databases
  'sqlite', 'sqlite3', 'db', 'db3', 'mdb', 'accdb',
  'parquet', 'orc', 'avro', 'feather', 'npy', 'npz',
  // Design (binary / container formats).
  // NOTE: '.ai' and '.fig' are deliberately EXCLUDED — they are ambiguous:
  // legacy Illustrator '.ai' is PostScript/PDF text (like the excluded '.eps'),
  // and '.fig' can be Xfig plain text, not only Figma. Forcing them to binary
  // would break editing a text variant, so they stay on the text path.
  'sketch', 'xd', 'afdesign', 'afphoto',
]);

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
    rtf: 'application/rtf',
    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
  };
  return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
}
