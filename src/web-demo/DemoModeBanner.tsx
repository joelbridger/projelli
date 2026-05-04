/**
 * Stream D-web Group IV · Task 4.1
 *
 * Sticky top banner that always identifies the current surface as the demo.
 * Renders above <App />; uses inline styles plus a small Tailwind layer so
 * the banner shows even before global CSS resolves (the demo bundle and the
 * app's stylesheet both load on first paint, but the banner is the one piece
 * of UI that absolutely must not flash invisible).
 *
 * The CTA carries UTM parameters so Plausible can attribute downloads from
 * the banner separately from the homepage primary CTA and from the
 * DemoExitModal (Task 4.3).
 */

import { Button } from '@/components/ui/button';
import { BYOKKeyInput } from './BYOKKeyInput';
import { trackDemoDownloadClicked } from './demoPlausible';

const DOWNLOAD_URL =
  'https://projelli.com/#download?utm_source=demo&utm_campaign=v2-launch&utm_content=banner';

export function DemoModeBanner() {
  return (
    <div
      data-testid="demo-mode-banner"
      role="banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#fef3c7',
        borderBottom: '1px solid #fcd34d',
        color: '#78350f',
        fontSize: 13,
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <span>
        You are using the Projelli demo. Files live in your browser only and
        are not synced anywhere.
      </span>
      <BYOKKeyInput />
      <Button
        asChild
        size="sm"
        variant="default"
        data-testid="demo-banner-download-button"
      >
        <a
          href={DOWNLOAD_URL}
          rel="noopener"
          onClick={() => {
            trackDemoDownloadClicked('banner');
          }}
        >
          Download for full version
        </a>
      </Button>
    </div>
  );
}

export const DEMO_BANNER_DOWNLOAD_URL = DOWNLOAD_URL;
