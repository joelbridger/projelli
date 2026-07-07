import { BRAND } from '@/config/brand';

interface AppLogoProps {
  /** Height of the logo in px (default 80) */
  height?: number;
  /** Brand-system logo variant */
  variant?: 'default' | 'dark' | 'white';
  /** Additional className on the wrapper */
  className?: string;
  /** @deprecated Use height instead. Kept for call-site compatibility. */
  iconSize?: number;
  /** @deprecated Use height instead. Kept for call-site compatibility. */
  wordmarkHeight?: number;
}

export function AppLogo({
  height,
  variant = 'default',
  iconSize = 80,
  className = '',
}: AppLogoProps) {
  const h = height ?? iconSize;
  const src =
    variant === 'dark'
      ? BRAND.assets.logoDark
      : variant === 'white'
        ? BRAND.assets.logoWhite
        : BRAND.assets.logo;
  return (
    <img
      src={src}
      height={h}
      style={{ width: 'auto', height: h, display: 'block' }}
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
