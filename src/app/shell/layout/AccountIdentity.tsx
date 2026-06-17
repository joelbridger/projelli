import { Building2, User, ChevronRight } from 'lucide-react';
import { useProfileStore } from '@/stores/profileStore';
import { useFirm } from '@/hooks/useFirm';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  if (!first) return '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  if (!last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

interface AccountIdentityProps {
  collapsed?: boolean;
  onOpen: () => void;
}

/**
 * The account / firm identity in the navy rail. A solo user shows their name +
 * profile picture; a firm shows its name + logo. Clicking it opens the Account
 * window. Replaces the old "Collapse" affordance at the bottom of the rail.
 */
export function AccountIdentity({ collapsed = false, onOpen }: AccountIdentityProps) {
  const { isSignedIn, org } = useFirm();
  const isFirm = isSignedIn;
  const soloName = useProfileStore((s) => s.soloName);
  const soloAvatar = useProfileStore((s) => s.soloAvatar);
  const firmName = useProfileStore((s) => s.firmName);
  const firmLogo = useProfileStore((s) => s.firmLogo);

  // A firm's name comes from its subscription (org.name); the stored firmName is
  // an optional display override.
  const name = isFirm ? firmName || org?.name || 'Your firm' : soloName || 'Your account';
  const image = isFirm ? firmLogo : soloAvatar;
  const sublabel = isFirm ? 'Firm account' : 'Solo account';
  const PlaceholderIcon = isFirm ? Building2 : User;
  const ini = initials(name);

  const avatar = (size: number) => (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,255,255,0.12)',
        color: '#fff',
        fontSize: 'var(--kp-font-2xs)',
        fontWeight: 'var(--kp-weight-bold)',
      }}
    >
      {image ? (
        <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : ini ? (
        ini
      ) : (
        <PlaceholderIcon size={Math.round(size * 0.55)} strokeWidth={2} />
      )}
    </span>
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={name}
        aria-label={`Account: ${name}`}
        data-testid="account-identity"
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          border: 0,
          cursor: 'pointer',
          background: 'transparent',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        {avatar(28)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="account-identity"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--kp-space-sm)',
        flex: 1,
        minWidth: 0,
        padding: 'var(--kp-space-sm) var(--kp-space-md)',
        border: 0,
        background: 'transparent',
        color: '#fff',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {avatar(28)}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </span>
        <span style={{ display: 'block', fontSize: 'var(--kp-font-2xs)', color: 'rgba(255,255,255,0.55)' }}>
          {sublabel}
        </span>
      </span>
      <ChevronRight size={15} strokeWidth={2} style={{ flex: 'none', opacity: 0.5 }} />
    </button>
  );
}
