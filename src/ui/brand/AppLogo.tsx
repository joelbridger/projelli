import { BRAND } from '@/config/brand';

interface AppLogoProps {
  /** Height of the logo in px (default 80) */
  height?: number;
  /** Additional className on the wrapper */
  className?: string;
  /** @deprecated Use height instead. Kept for call-site compatibility. */
  iconSize?: number;
  /** @deprecated Use height instead. Kept for call-site compatibility. */
  wordmarkHeight?: number;
}

export function AppLogo({
  height,
  iconSize = 80,
  className = '',
}: AppLogoProps) {
  const h = height ?? iconSize;
  return (
    <img
      src="/logo.svg"
      height={h}
      style={{ width: 'auto', display: 'block' }}
      alt={BRAND.name}
      className={className}
    />
  );
}

export function AppIcon({ size = 64 }: { size?: number }) {
  return <AppLogo height={size} />;
}

export function AppWordmark({ height = 28 }: { height?: number }) {
  return <AppLogo height={height} />;
}
