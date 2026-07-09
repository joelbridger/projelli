export type ConnectorBrand = 'gmail' | 'm365' | 'onedrive' | 'wealthbox';

const CONNECTOR_LOGOS: Record<Exclude<ConnectorBrand, 'gmail'>, { alt: string; src: string }> = {
  m365: { alt: 'Microsoft Outlook logo', src: '/onboarding/logos/outlook.svg' },
  onedrive: { alt: 'OneDrive logo', src: '/onboarding/logos/onedrive.svg' },
  wealthbox: { alt: 'Wealthbox logo', src: '/onboarding/logos/wealthbox.svg' },
};

export function ConnectorLogo({ brand }: { brand: ConnectorBrand }) {
  if (brand === 'gmail') return <GmailLogo />;

  const logo = CONNECTOR_LOGOS[brand];
  return (
    <img
      src={logo.src}
      alt={logo.alt}
      className="max-h-8 max-w-full object-contain"
      draggable={false}
    />
  );
}

function GmailLogo() {
  return (
    <svg
      viewBox="0 0 48 36"
      role="img"
      aria-label="Gmail logo"
      className="h-8 w-10"
    >
      <path
        d="M4.5 36h39A4.5 4.5 0 0 0 48 31.5V4.8L24 22.5 0 4.8v26.7A4.5 4.5 0 0 0 4.5 36Z"
        fill="var(--connector-gmail-surface)"
      />
      <path
        d="M0 4.8v26.7A4.5 4.5 0 0 0 4.5 36H12V13.7L0 4.8Z"
        fill="var(--connector-gmail-green)"
      />
      <path
        d="M36 13.7V36h7.5a4.5 4.5 0 0 0 4.5-4.5V4.8l-12 8.9Z"
        fill="var(--connector-gmail-blue)"
      />
      <path
        d="M12 13.7V36h24V13.7L24 22.5 12 13.7Z"
        fill="var(--connector-gmail-yellow)"
      />
      <path
        d="M4.5 0A4.5 4.5 0 0 0 0 4.5v.3l24 17.7L48 4.8v-.3A4.5 4.5 0 0 0 43.5 0H42L24 13.3 6 0H4.5Z"
        fill="var(--connector-gmail-red)"
      />
    </svg>
  );
}
