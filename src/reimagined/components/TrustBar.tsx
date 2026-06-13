/**
 * The Trust Bar — the reimagining's hero element.
 *
 * Research finding (Streams A + C converge): the egress indicator was the
 * single most emotionally powerful moment in the persona study, yet today it
 * is buried among nine items in a 24px status strip. Here it is elevated: an
 * always-visible, legible, accessible statement of which matter you are in and
 * exactly where this prompt would go. Three states, plain English, AA contrast.
 */
import { Globe, Briefcase, Map as MapIcon, ChevronDown } from 'lucide-react';
import type { Confidentiality, Matter } from '../data';

const EGRESS: Record<Confidentiality, { cls: string; label: string; sub: string; aria: string }> = {
  local: {
    cls: 'kp-egress--local',
    label: 'On your machine',
    sub: 'Nothing leaves',
    aria: 'Confidentiality: local only. Nothing leaves this computer.',
  },
  direct: {
    cls: 'kp-egress--direct',
    label: 'Direct to Anthropic',
    sub: 'from your device, not via Keepance',
    aria: 'Confidentiality: direct to your AI provider. Your question goes to Anthropic from your device. Keepance never sees it.',
  },
  assured: {
    cls: 'kp-egress--assured',
    label: 'Through your firm’s relay',
    sub: 'zero retention',
    aria: 'Confidentiality: assured. Through your firm’s private relay, which stores nothing.',
  },
};

interface Props {
  matter: Matter | null; // null = all-matters scope
  egress: Confidentiality;
  live?: boolean;
  onOpenDataMap: () => void;
}

export function TrustBar({ matter, egress, live, onOpenDataMap }: Props) {
  const e = EGRESS[egress];
  return (
    <div className="kp-trustbar">
      <div className="kp-scope">
        {matter ? (
          <Briefcase className="kp-scope-ico" strokeWidth={1.75} />
        ) : (
          <Globe className="kp-scope-ico" strokeWidth={1.75} />
        )}
        <div className="kp-scope-text">
          <div className="kp-scope-name">{matter ? matter.title : 'All matters'}</div>
          <div className="kp-scope-sub">
            {matter ? (
              <>
                <span className="kp-scope-num">{matter.number}</span>
                <span>·</span>
                <span>{matter.client}</span>
              </>
            ) : (
              <span>Searching across every matter. Nothing crosses between clients.</span>
            )}
          </div>
        </div>
        <ChevronDown className="kp-ico" style={{ width: 16, height: 16, color: 'var(--kp-ink-3)' }} strokeWidth={1.75} />
      </div>

      <div className="kp-trust-spacer" />

      <button
        type="button"
        className="kp-iconbtn"
        title="Data Map — where your data goes, in plain English"
        aria-label="Open the Data Map"
        onClick={onOpenDataMap}
      >
        <MapIcon className="kp-ico" style={{ width: 18, height: 18 }} strokeWidth={1.75} />
      </button>

      <div
        className={`kp-egress ${e.cls} ${live ? 'kp-egress--live' : ''}`}
        role="status"
        aria-label={e.aria}
      >
        <span className="kp-egress-dot" />
        <span className="kp-egress-label">
          <b>{e.label}</b>
        </span>
        <span className="kp-egress-sub">· {e.sub}</span>
      </div>
    </div>
  );
}
