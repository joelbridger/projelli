/**
 * Read a user-selected image file and return a small, square-ish data URL,
 * resized so it stays light in localStorage (avatars / firm logos). Keeps the
 * aspect ratio, longest side capped at `maxSize`. Falls back to the raw data
 * URL if canvas is unavailable (e.g. older test environments).
 */
export async function readImageAsDataUrl(file: File, maxSize = 256): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : ''); };
    reader.onerror = () => { reject(new Error('Could not read the image file.')); };
    reader.readAsDataURL(file);
  });

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => { resolve(el); };
      el.onerror = () => { reject(new Error('Could not decode the image.')); };
      el.src = rawDataUrl;
    });
    const longest = Math.max(img.width, img.height) || maxSize;
    const scale = Math.min(1, maxSize / longest);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return rawDataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    // PNG preserves transparency for logos; small at this size.
    return canvas.toDataURL('image/png');
  } catch {
    return rawDataUrl;
  }
}
