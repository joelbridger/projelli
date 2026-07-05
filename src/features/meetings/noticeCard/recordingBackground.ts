/**
 * Notice Card — the official "⏺ RECORDING in progress" virtual-background image.
 *
 * A quick win for platforms/meetings where the card can't join (Google Meet,
 * in-person-with-a-webcam, or an advisor who just prefers it): a clean, calm
 * background image the advisor uploads as their Teams/Zoom virtual background so
 * every participant sees the recording notice the whole meeting.
 *
 * `drawRecordingBackground` is pure + tested; the render/save helpers are thin
 * browser wrappers (canvas → PNG → download).
 */

/** Draw the recording-background image onto a 2D context. Calm light theme. */
export function drawRecordingBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  labelText: string,
): void {
  // Soft light wash.
  ctx.fillStyle = '#eef1f5';
  ctx.fillRect(0, 0, width, height);
  // A centered band so the label stays legible over any camera framing.
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, height * 0.4, width, height * 0.2);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c0392b';
  ctx.font = `bold ${String(Math.round(height * 0.075))}px system-ui, Segoe UI, Arial, sans-serif`;
  ctx.fillText(`⏺ ${labelText}`, width / 2, height * 0.5);
}

/** Default output size — 1080p, the common virtual-background resolution. */
export const RECORDING_BG_SIZE = { width: 1920, height: 1080 } as const;

/**
 * Render the background to a PNG Blob. Browser-only (needs a real canvas);
 * rejects if canvas/toBlob is unavailable.
 */
export function renderRecordingBackgroundPng(labelText: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = RECORDING_BG_SIZE.width;
      canvas.height = RECORDING_BG_SIZE.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('no 2d context'));
        return;
      }
      drawRecordingBackground(ctx, canvas.width, canvas.height, labelText);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob failed'));
      }, 'image/png');
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Render + trigger a download of the background image. Best-effort; safe to call
 * from a settings button. Returns true if the download was initiated.
 */
export async function saveRecordingBackgroundImage(
  labelText: string,
  filename = 'recording-notice-background.png',
): Promise<boolean> {
  try {
    const blob = await renderRecordingBackgroundPng(labelText);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has consumed the URL.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
    return true;
  } catch {
    return false;
  }
}
