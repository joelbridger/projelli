/**
 * The Spine — the left rail. The binder spine of the case file: navy, with
 * matters hanging off it (matter is the organizing concept of the practice).
 */
import { Briefcase, Sparkles, FolderOpen, ShieldCheck, Plus, Settings } from 'lucide-react';
import { FIRM, ATTORNEY, MATTERS, type Matter } from '../data';
import type { TopView } from '../ReimaginedApp';

const STATUS_DOT: Record<Matter['status'], string> = {
  open: 'var(--kp-local)',
  pending: 'var(--kp-direct)',
  closed: 'var(--kp-ink-3)',
};

interface Props {
  view: TopView;
  activeMatterId: string | null;
  onNav: (view: TopView) => void;
  onSelectMatter: (id: string) => void;
}

export function Spine({ view, activeMatterId, onNav, onSelectMatter }: Props) {
  const openMatters = MATTERS.filter((m) => m.status !== 'closed');
  const nav: { id: TopView; label: string; Icon: typeof Briefcase; count?: number }[] = [
    { id: 'matters', label: 'Matters', Icon: Briefcase, count: openMatters.length },
    { id: 'ask', label: 'Ask', Icon: Sparkles },
    { id: 'documents', label: 'Documents', Icon: FolderOpen },
    { id: 'defense', label: 'Your defense file', Icon: ShieldCheck },
  ];

  return (
    <aside className="kp-spine">
      <div className="kp-brand">
        <span className="kp-brand-mark">Keepance<span className="kp-dot">.</span></span>
      </div>
      <div className="kp-brand" style={{ paddingTop: 0, paddingBottom: 14 }}>
        <span className="kp-brand-firm">{FIRM}</span>
      </div>

      <div className="kp-spine-section">
        <nav className="kp-nav" aria-label="Primary">
          {nav.map(({ id, label, Icon, count }) => (
            <button
              key={id}
              type="button"
              className="kp-nav-item"
              aria-current={view === id && activeMatterId === null}
              onClick={() => onNav(id)}
            >
              <Icon className="kp-ico" strokeWidth={1.75} />
              <span>{label}</span>
              {count != null && <span className="kp-nav-count">{count}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="kp-spine-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Open matters</span>
        <Plus className="kp-ico" style={{ width: 15, height: 15, opacity: 0.7, cursor: 'pointer' }} strokeWidth={1.75} />
      </div>
      <div className="kp-spine-matters">
        {openMatters.map((m) => (
          <button
            key={m.id}
            type="button"
            className="kp-matter-link"
            aria-current={activeMatterId === m.id}
            onClick={() => onSelectMatter(m.id)}
          >
            <div className="kp-ml-name">{m.title}</div>
            <div className="kp-ml-meta">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[m.status], flex: 'none' }} />
              <span className="kp-mono">{m.number}</span>
              <span>·</span>
              <span>{m.area}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="kp-spine-foot">
        <span className="kp-avatar">{ATTORNEY.initials}</span>
        <span style={{ flex: 1 }}>{ATTORNEY.name}</span>
        <Settings className="kp-ico" style={{ width: 16, height: 16, opacity: 0.7, cursor: 'pointer' }} strokeWidth={1.75} />
      </div>
    </aside>
  );
}
