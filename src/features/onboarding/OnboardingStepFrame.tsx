/**
 * OnboardingStepFrame — the branded chrome that wraps each GuidedOnboarding step.
 *
 * Layout: fixed full-screen overlay with a frosted backdrop, a left navy rail
 * (Advisor Prep HeroMark + numbered step list), and a right white card that holds the
 * step's real content.  Matches the keepance.com brand: navy var(--kp-navy), Satoshi
 * font, pink-to-blue gradient accent.
 *
 * No Tailwind on the frame itself; uses CSS variables throughout so it adapts
 * if the host page ever changes class names.
 */
import { type CSSProperties, useRef, useEffect } from 'react';
import { Check } from 'lucide-react';

export interface StepInfo {
  label: string;
  done: boolean;
}

export interface OnboardingStepFrameProps {
  steps: StepInfo[];
  activeIndex: number;
  onSkip?: (() => void) | undefined;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Advisor Prep HeroMark — white keep + gradient sparkle (verbatim from Spine)
// ---------------------------------------------------------------------------
function AppBrandMark() {
  return (
    <svg
      viewBox="0 99 651 652"
      width="30"
      height="30"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <defs>
        <linearGradient
          id="kp-onb-g"
          x1="384.994"
          y1="476.943"
          x2="447.494"
          y2="408.443"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: 'var(--kp-pink)' }} />
          <stop offset="1" style={{ stopColor: 'var(--kp-blue)' }} />
        </linearGradient>
      </defs>
      <path
        fill="#fff"
        d="M612.169 350.339V313.508C612.169 275.857 612.169 248.386 611.033 228.706C610.754 221.189 609.929 213.699 608.564 206.289C608.021 203.699 607.503 201.765 607.009 200.486C606.808 199.885 606.543 199.305 606.219 198.754C606.169 198.707 605.799 198.286 604.861 197.584C603.807 196.726 602.096 195.642 599.726 194.332C594.862 191.664 587.949 188.575 578.395 184.878C559.286 177.53 532.055 168.685 494.701 156.564L480.579 151.978C440.708 139.061 424.734 134.1 408.489 134.1C392.244 134.1 376.271 139.061 336.399 151.978L322.278 156.587C284.924 168.685 257.693 177.53 238.584 184.901C229.03 188.575 222.117 191.641 217.253 194.308C214.883 195.634 213.171 196.726 212.118 197.584C211.628 197.933 211.173 198.325 210.76 198.754C210.711 198.848 210.414 199.316 209.97 200.486C209.46 201.765 208.941 203.699 208.415 206.289C207.05 213.699 206.225 221.189 205.946 228.706C205.477 236.839 205.201 246.302 205.04 257.264L168.201 246.84C168.374 239.501 168.619 232.83 168.963 226.811C169.58 216.351 170.493 207.248 172.049 199.667C173.53 192.343 175.9 184.761 180.467 178.607C185.084 172.359 191.874 167.702 198.663 163.958C205.699 160.097 214.463 156.283 224.635 152.375C244.83 144.607 273.074 135.434 309.637 123.593L327.586 117.743L327.743 117.692C363.301 106.163 385.391 99 408.489 99C431.588 99 453.678 106.163 489.236 117.692L489.393 117.743L507.342 123.593C543.905 135.434 572.149 144.607 592.344 152.375C601.256 155.702 609.931 159.571 618.316 163.958C625.105 167.702 631.895 172.359 636.536 178.583C641.079 184.761 643.449 192.343 644.93 199.643C646.577 208.619 647.608 217.686 648.016 226.787C649.201 247.543 649.201 275.998 649.201 312.876V350.339C649.201 453.132 590.223 517.396 531.946 555.787V511.74C575.209 477.203 612.169 425.67 612.169 350.339Z"
      />
      <path
        fill="#fff"
        d="M141.242 244.267C149.877 244.267 155.45 244.252 160.709 244.65L161.758 244.735L161.779 244.737L161.802 244.739C163.751 244.913 165.693 245.133 167.626 245.4C167.169 263.635 167.167 286.075 167.167 312.991V350.55C167.167 493.679 280.946 562.3 348.601 590.405L349.268 590.662C357.663 594.158 365.564 597.419 374.626 599.624C384.182 601.97 394.355 602.955 407.91 602.955C421.49 602.955 431.614 601.97 441.194 599.624C450.256 597.419 458.158 594.158 466.528 590.662L467.219 590.405C486.156 582.538 508.706 571.495 531.364 556.535C531.34 594.529 531.047 625.297 527.569 649.866C523.636 677.652 515.313 700.214 496.662 717.919C478.153 735.491 454.809 743.225 426.029 746.907C397.689 750.532 361.378 750.502 315.317 750.502H216.552C170.494 750.502 134.175 750.538 105.832 746.916C77.0504 743.238 53.6984 735.503 35.1963 717.909C16.5689 700.195 8.24639 677.642 4.30958 649.859C0.46262 622.709 0.500014 587.99 0.500014 544.304V371.805C0.512451 355.959 0.681877 345.108 2.58888 335.582C7.04192 313.207 18.4606 292.765 35.1904 276.865C51.9138 260.97 73.1754 250.335 96.1543 246.203V246.202C107.305 244.193 120.267 244.267 141.242 244.267ZM204.444 256.632C211.863 260.276 218.9 264.69 225.42 269.827L226.242 270.48C230.341 273.779 234.309 277.573 240.418 283.377L253.998 296.28C274.879 316.119 282.889 323.509 292.156 328.399L292.182 328.412C297.583 331.273 303.328 333.54 309.306 335.163C319.658 337.957 331.01 338.107 360.454 338.107H369.688C401.72 338.107 427.402 338.076 447.649 340.495C468.212 342.953 485.73 348.177 500.203 360.497H500.204C502.701 362.59 505.059 364.827 507.277 367.204C520.505 381.16 526.185 398.237 528.832 418.231C531.407 437.678 531.369 462.283 531.369 492.646V512.372C505.073 533.413 476.45 548.162 452.38 558.147C443.219 561.947 437.91 564.106 432.009 565.537C426.379 566.922 419.515 567.766 407.91 567.766C396.305 567.766 389.44 566.922 383.811 565.537C377.885 564.13 372.601 561.947 363.44 558.147C299.736 531.731 204.204 471.955 204.204 350.55V313.624C204.204 291.189 204.206 272.36 204.444 256.632Z"
      />
      <path
        fill="url(#kp-onb-g)"
        d="M401.124 390.027C401.997 387.79 403.524 385.868 405.507 384.513C407.489 383.158 409.834 382.434 412.236 382.434C414.637 382.434 416.982 383.158 418.965 384.513C420.947 385.868 422.475 387.79 423.347 390.027L433.964 417.064C434.554 418.596 435.456 419.988 436.612 421.152C437.768 422.317 439.154 423.229 440.68 423.83L467.619 434.497C469.85 435.385 471.763 436.923 473.11 438.91C474.458 440.898 475.178 443.244 475.178 445.645C475.178 448.046 474.458 450.392 473.11 452.38C471.763 454.367 469.85 455.905 467.619 456.793L440.705 467.46C439.191 468.081 437.815 468.996 436.658 470.153C435.501 471.311 434.585 472.686 433.964 474.201L423.347 501.213C422.475 503.45 420.947 505.372 418.965 506.727C416.982 508.082 414.637 508.807 412.236 508.807C409.834 508.807 407.489 508.082 405.507 506.727C403.524 505.372 401.997 503.45 401.124 501.213L390.507 474.176C389.886 472.662 388.971 471.286 387.814 470.129C386.656 468.971 385.281 468.056 383.766 467.435L356.852 456.768C354.622 455.88 352.709 454.342 351.361 452.355C350.013 450.368 349.293 448.021 349.293 445.62C349.293 443.219 350.013 440.873 351.361 438.885C352.709 436.898 354.622 435.36 356.852 434.472L383.766 423.805C385.283 423.182 386.66 422.262 387.817 421.101C388.975 419.939 389.889 418.558 390.507 417.04L401.124 390.027Z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

const RAIL_W = 240;
const CARD_PADDING = 40;

// Focusable elements for the tab trap.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function OnboardingStepFrame({
  steps,
  activeIndex,
  onSkip,
  footer,
  children,
}: OnboardingStepFrameProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Focus the card on mount; restore focus on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Tab/Shift+Tab focus trap within the card.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, []);

  const backdrop: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'flex',
    alignItems: 'stretch',
    background: 'rgba(var(--kp-navy-rgb),0.55)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    fontFamily: 'var(--font-sans)',
  };

  const rail: CSSProperties = {
    width: RAIL_W,
    background: 'var(--kp-navy)',
    display: 'flex',
    flexDirection: 'column',
    padding: '32px 0',
    position: 'relative',
    flex: 'none',
  };

  const railAccent: CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 2,
    background: 'var(--kp-accent)',
    opacity: 0.85,
  };

  const railLogoRow: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 24px 28px',
    borderBottom: '1px solid rgba(255,255,255,0.10)',
    marginBottom: 24,
  };

  const logoLabel: CSSProperties = {
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: '-0.02em',
    color: '#fff',
  };

  const stepListStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '0 14px',
    flex: 1,
    overflowY: 'auto',
  };

  const cardWrap: CSSProperties = {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 32px',
    minWidth: 0,
  };

  const card: CSSProperties = {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 8px 40px rgba(var(--kp-navy-rgb),0.18)',
    width: '100%',
    maxWidth: 680,
    maxHeight: 'calc(100vh - 48px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  };

  const cardBody: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: `${String(CARD_PADDING)}px ${String(CARD_PADDING)}px 24px`,
  };

  const cardFooter: CSSProperties = {
    padding: `20px ${String(CARD_PADDING)}px`,
    borderTop: '1px solid hsl(214.3 31.8% 90%)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 'none',
    background: '#fff',
  };

  const skipBtn: CSSProperties = {
    position: 'absolute',
    top: 16,
    right: 16,
    fontSize: 12,
    color: 'hsl(215.4 16.3% 44%)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
  };

  return (
    <div style={backdrop} data-testid="guided-onboarding-frame">
      {/* Left navy rail */}
      <nav style={rail} aria-label="Onboarding steps">
        <div style={railAccent} />
        <div style={railLogoRow}>
          <AppBrandMark />
          <span style={logoLabel}>Advisor Prep Hero</span>
        </div>
        <ol style={stepListStyle}>
          {steps.map((step, i) => (
            <StepItem
              key={step.label}
              index={i}
              label={step.label}
              done={step.done}
              active={i === activeIndex}
            />
          ))}
        </ol>
      </nav>

      {/* Right content card */}
      <div style={cardWrap}>
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label="Advisor Prep Hero setup"
          tabIndex={-1}
          style={{ ...card, outline: 'none' }}
        >
          {onSkip && (
            <button
              type="button"
              style={skipBtn}
              onClick={onSkip}
              data-testid="onboarding-skip-btn"
            >
              Skip setup
            </button>
          )}
          <div style={cardBody}>{children}</div>
          {footer && <div style={cardFooter}>{footer}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepItem — one row in the step list
// ---------------------------------------------------------------------------

interface StepItemProps {
  index: number;
  label: string;
  done: boolean;
  active: boolean;
}

function StepItem({ index, label, done, active }: StepItemProps) {
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 6,
    background: active ? 'rgba(var(--kp-blue-rgb),0.12)' : 'transparent',
    position: 'relative',
  };

  const badge: CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    flex: 'none',
    background: done
      ? 'var(--kp-accent)'
      : active
        ? 'rgba(var(--kp-blue-rgb),0.22)'
        : 'rgba(255,255,255,0.10)',
    color: done ? '#fff' : active ? '#fff' : 'rgba(255,255,255,0.55)',
    border: active && !done ? '1.5px solid rgba(var(--kp-blue-rgb),0.55)' : 'none',
  };

  const labelStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? '#fff' : done ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.5)',
    lineHeight: 1.3,
  };

  // Gradient accent bar for the active step
  const accent: CSSProperties = {
    position: 'absolute',
    left: 3,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 3,
    height: 18,
    borderRadius: 3,
    background: 'var(--kp-accent)',
    display: active ? 'block' : 'none',
  };

  return (
    <li style={row} aria-current={active ? 'step' : undefined} data-testid={`onb-step-${String(index)}`}>
      <span style={accent} />
      <span style={badge} aria-hidden>
        {done ? <Check size={13} /> : index + 1}
      </span>
      <span style={labelStyle}>{label}</span>
    </li>
  );
}
