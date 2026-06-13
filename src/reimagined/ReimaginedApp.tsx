/**
 * Reimagined UI — the shell. Matter-centric navigation, the hero Trust Bar,
 * and a screen router over mock data. Prototype for Phase 2 / Gate 2.
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Spine } from './components/Spine';
import { TrustBar } from './components/TrustBar';
import {
  MattersHome, MatterOverview, AskScreen, AssociateScreen, MatterDocuments, TrustMapContent,
} from './screens';
import { DocEditor } from './DocEditor';
import { MATTERS, type Matter } from './data';

export type TopView = 'matters' | 'ask' | 'documents' | 'defense';

const MATTER_TABS: { id: string; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'ask', label: 'Ask' },
  { id: 'associate', label: 'Associate' },
  { id: 'documents', label: 'Documents' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'trust', label: 'Trust Map' },
];

export function ReimaginedApp() {
  const [view, setView] = useState<TopView>('matters');
  const [activeMatterId, setActiveMatterId] = useState<string | null>(null);
  const [matterTab, setMatterTab] = useState('overview');
  const [dataMapOpen, setDataMapOpen] = useState(false);

  const matter: Matter | null = activeMatterId ? MATTERS.find((m) => m.id === activeMatterId) ?? null : null;

  function goNav(v: TopView) { setView(v); setActiveMatterId(null); }
  function openMatter(id: string) { setActiveMatterId(id); setMatterTab('overview'); }

  useEffect(() => {
    if (!dataMapOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDataMapOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dataMapOpen]);

  const egress = matter ? matter.confidentiality : 'local';

  return (
    <div className="kp-shell">
      <Spine view={view} activeMatterId={activeMatterId} onNav={goNav} onSelectMatter={openMatter} />

      <main className="kp-main">
        <TrustBar matter={matter} egress={egress} onOpenDataMap={() => setDataMapOpen(true)} />

        {matter && (
          <div style={{ display: 'flex', gap: 2, padding: '0 22px', background: 'var(--kp-surface)', borderBottom: '1px solid var(--kp-hairline)', flex: 'none' }}>
            {MATTER_TABS.map((t) => {
              const on = matterTab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setMatterTab(t.id)}
                  data-testid={`mtab-${t.id}`}
                  aria-current={on}
                  style={{
                    border: 0, background: 'transparent', cursor: 'pointer', padding: '11px 14px',
                    fontSize: 13, fontWeight: on ? 600 : 500, color: on ? 'var(--kp-navy)' : 'var(--kp-ink-2)',
                    borderBottom: on ? '2px solid var(--kp-navy)' : '2px solid transparent', marginBottom: -1,
                  }}>
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="kp-canvas">
          {!matter && view === 'matters' && <MattersHome onOpenMatter={openMatter} />}
          {!matter && view === 'ask' && <AskScreen matter={null} />}
          {!matter && view === 'documents' && <MatterDocuments />}
          {!matter && view === 'defense' && <DefenseFile />}

          {matter && matterTab === 'overview' && <MatterOverview matter={matter} onTab={setMatterTab} />}
          {matter && matterTab === 'ask' && <AskScreen matter={matter} />}
          {matter && matterTab === 'associate' && <AssociateScreen matter={matter} />}
          {matter && matterTab === 'documents' && <MatterDocuments />}
          {matter && matterTab === 'drafts' && <DocEditor />}
          {matter && matterTab === 'trust' && (
            <div className="kp-page kp-rise" style={{ maxWidth: 860 }}>
              <div className="kp-eyebrow">Trust Map · {matter.title}</div>
              <h1 className="kp-h1" style={{ marginTop: 4, marginBottom: 6 }}>Where this matter’s data goes</h1>
              <div className="kp-h1-sub" style={{ marginBottom: 20 }}>Plain English. Printable, so you can show a client or staple it to an engagement letter.</div>
              <TrustMapContent />
            </div>
          )}
        </div>
      </main>

      {dataMapOpen && (
        <div role="presentation" onClick={() => setDataMapOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,40,0.34)', display: 'grid', placeItems: 'center', zIndex: 50, backdropFilter: 'blur(1.5px)' }}>
          <div role="dialog" aria-modal="true" aria-labelledby="kp-dm-title" onClick={(e) => e.stopPropagation()}
            className="kp-card kp-rise" style={{ width: 'min(640px, 92vw)', maxHeight: '86vh', overflow: 'auto', boxShadow: 'var(--kp-shadow-pop)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--kp-hairline)', position: 'sticky', top: 0, background: 'var(--kp-surface)' }}>
              <div>
                <div className="kp-eyebrow">Data Map</div>
                <h2 id="kp-dm-title" className="kp-h2">Where your data goes</h2>
              </div>
              <button type="button" className="kp-iconbtn" aria-label="Close" onClick={() => setDataMapOpen(false)}>
                <X className="kp-ico" style={{ width: 18, height: 18 }} strokeWidth={1.75} />
              </button>
            </div>
            <div style={{ padding: 20 }}><TrustMapContent /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function DefenseFile() {
  const rows = [
    { when: 'Today, 2:14 PM', action: 'Ask', matter: 'Brennan v. Vanguard Logistics', detail: 'Question answered locally over the matter index. 4 cited findings.' },
    { when: 'Today, 1:02 PM', action: 'Associate', matter: 'Brennan v. Vanguard Logistics', detail: 'Contradiction analysis run. No content left this machine.' },
    { when: 'Today, 11:40 AM', action: 'Draft', matter: 'Brennan v. Vanguard Logistics', detail: 'Demand Letter draft 3 created on letterhead.' },
    { when: 'Yesterday, 4:31 PM', action: 'Ask', matter: 'Castellano v. Meridian Insurance', detail: 'Question sent to Anthropic from this device (Direct mode).' },
  ];
  return (
    <div className="kp-page kp-rise" style={{ maxWidth: 920 }}>
      <div className="kp-eyebrow">Your defense file</div>
      <h1 className="kp-h1" style={{ marginTop: 4, marginBottom: 6 }}>A private record of every AI action</h1>
      <div className="kp-h1-sub" style={{ marginBottom: 20 }}>Kept on your machine, for your files and your defense. Export to PDF for a privilege log or a bar inquiry.</div>
      <div className="kp-card" style={{ overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 110px 1fr', gap: 14, padding: '13px 18px', borderBottom: i < rows.length - 1 ? '1px solid var(--kp-hairline)' : 'none', alignItems: 'center' }}>
            <span className="kp-mono" style={{ fontSize: 11.5, color: 'var(--kp-ink-3)' }}>{r.when}</span>
            <span className="kp-eyebrow" style={{ fontSize: 10 }}>{r.action}</span>
            <div>
              <div style={{ fontSize: 13, color: 'var(--kp-ink)' }}>{r.detail}</div>
              <div style={{ fontSize: 11.5, color: 'var(--kp-ink-3)', marginTop: 1 }}>{r.matter}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
