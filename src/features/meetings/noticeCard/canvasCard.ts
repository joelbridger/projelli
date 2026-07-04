/**
 * Notice Card — the visual card (v2 canvas camera).
 *
 * The cost-collapsing trick: because we own the companion webview, we can hand
 * the meeting page a "camera" that is actually a locally-rendered canvas. No
 * OS-level virtual-camera driver needed. This module renders the calm notice
 * card to a canvas and builds the injected script that (a) draws it on a loop
 * with a live "Recording · M:SS" timer and (b) overrides `getUserMedia` so the
 * meeting client sees the canvas as the camera.
 *
 * `drawNoticeCard` and `formatRecordingTimer` are pure + self-contained
 * (closure-free) so the SAME source is both unit-tested here and serialized
 * into the injected script. All dynamic copy is interpolated via JSON.stringify
 * (safe escaping), never raw.
 */

/** The firm-customizable card copy (localized upstream, from notice settings). */
export interface NoticeCardVisual {
  /** Headline line, e.g. "This meeting is being recorded by Sarah Morgan". */
  title: string;
  /** Up to three short reassurance lines. */
  lines: string[];
  /** The departure-signal footer, e.g. "This card leaves when recording ends". */
  footer: string;
  /** Localized word before the timer, e.g. "Recording". */
  recordingLabel: string;
  /** Optional firm logo as a data URI (drawn top-center if present). */
  logoDataUrl?: string;
}

/** Elapsed recording time as "M:SS" (or "H:MM:SS" past an hour). Never negative. */
export function formatRecordingTimer(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) {
    const mm = String(m).padStart(2, '0');
    return `${String(h)}:${mm}:${ss}`;
  }
  return `${String(m)}:${ss}`;
}

/**
 * Draw the notice card onto a 2D context. Calm light theme, firm logo slot,
 * headline, up to three reassurance lines, a prominent "Recording · M:SS"
 * timer, and the departure-signal footer. Self-contained (no external helpers)
 * so it serializes faithfully into the injected script.
 */
export function drawNoticeCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: NoticeCardVisual & { timerText: string; logo?: CanvasImageSource },
): void {
  // Calm light background.
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, width, height);
  // Soft card panel.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(width * 0.08, height * 0.1, width * 0.84, height * 0.8);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = width / 2;
  let y = height * 0.24;

  // Optional firm logo.
  if (model.logo) {
    try {
      ctx.drawImage(model.logo, cx - width * 0.06, height * 0.13, width * 0.12, width * 0.12);
    } catch {
      /* logo optional */
    }
  }

  // The red recording dot + headline.
  ctx.fillStyle = '#c0392b';
  ctx.font = `bold ${String(Math.round(height * 0.055))}px system-ui, Segoe UI, Arial, sans-serif`;
  ctx.fillText(`⏺ ${model.title}`, cx, y);
  y += height * 0.12;

  // Reassurance lines.
  ctx.fillStyle = '#2c3e50';
  ctx.font = `${String(Math.round(height * 0.04))}px system-ui, Segoe UI, Arial, sans-serif`;
  const lines = model.lines;
  for (let i = 0; i < lines.length && i < 3; i++) {
    ctx.fillText(lines[i] || '', cx, y);
    y += height * 0.075;
  }

  // Prominent live timer.
  y += height * 0.02;
  ctx.fillStyle = '#c0392b';
  ctx.font = `bold ${String(Math.round(height * 0.06))}px system-ui, Segoe UI, Arial, sans-serif`;
  ctx.fillText(`${model.recordingLabel} · ${model.timerText}`, cx, y);

  // Departure-signal footer.
  ctx.fillStyle = '#7f8c8d';
  ctx.font = `${String(Math.round(height * 0.032))}px system-ui, Segoe UI, Arial, sans-serif`;
  ctx.fillText(model.footer, cx, height * 0.82);
}

/**
 * Build the injected camera script. It creates an offscreen canvas, draws the
 * card on a loop with a live timer, captures the canvas as a video stream, and
 * overrides `navigator.mediaDevices.getUserMedia` so the meeting client uses
 * that stream as the camera. Audio stays muted (we join muted; v3 adds a spoken
 * announcement through the same interception point).
 *
 * VERIFY-LIVE: the getUserMedia override behavior against real Teams/Zoom web
 * clients is confirmed on the bench; the render + timer logic is unit-tested.
 */
export function buildCameraScript(
  visual: NoticeCardVisual,
  opts: { startEpochMs: number; width?: number; height?: number; fps?: number },
): string {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const fps = opts.fps ?? 8;
  const model = {
    title: visual.title,
    lines: visual.lines,
    footer: visual.footer,
    recordingLabel: visual.recordingLabel,
    logoDataUrl: visual.logoDataUrl ?? null,
  };
  return `
    (function () {
      try {
        var MODEL = ${JSON.stringify(model)};
        var START = ${JSON.stringify(opts.startEpochMs)};
        var W = ${JSON.stringify(width)}, H = ${JSON.stringify(height)}, FPS = ${JSON.stringify(fps)};
        var formatRecordingTimer = ${formatRecordingTimer.toString()};
        var drawNoticeCard = ${drawNoticeCard.toString()};
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');
        var logo = null;
        if (MODEL.logoDataUrl) {
          try { logo = new Image(); logo.src = MODEL.logoDataUrl; } catch (e) { logo = null; }
        }
        function paint() {
          try {
            var elapsed = Date.now() - START;
            drawNoticeCard(ctx, W, H, {
              title: MODEL.title, lines: MODEL.lines, footer: MODEL.footer,
              recordingLabel: MODEL.recordingLabel,
              timerText: formatRecordingTimer(elapsed),
              logo: (logo && logo.complete) ? logo : undefined,
            });
          } catch (e) {}
        }
        paint();
        setInterval(paint, Math.max(200, Math.floor(1000 / FPS)));
        var cardStream = canvas.captureStream ? canvas.captureStream(FPS) : null;
        var md = navigator.mediaDevices;
        if (md && md.getUserMedia && cardStream) {
          var real = md.getUserMedia.bind(md);
          md.getUserMedia = function (constraints) {
            try {
              if (constraints && constraints.video) {
                var s = new MediaStream();
                cardStream.getVideoTracks().forEach(function (t) { s.addTrack(t); });
                // We joined muted; hand back only the card video, no live mic.
                return Promise.resolve(s);
              }
            } catch (e) {}
            return real(constraints);
          };
        }
      } catch (e) {}
    })();
  `;
}
