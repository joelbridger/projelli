/**
 * The document editor — Word-native redline. Research non-negotiable: output is
 * a real .docx on letterhead, AI edits appear as standard tracked changes
 * attributed to the ATTORNEY's name (never "Keepance AI"), accept/reject per
 * change, with a Reviewing-pane list (the Word model attorneys already know).
 */
import { useState, type ReactNode } from 'react';
import { Check, X, Sparkles, FileText, Printer, CheckCheck } from 'lucide-react';

interface Change { id: string; author: string; kind: 'insert' | 'delete'; text: string; note: string; }

const CHANGES: Change[] = [
  { id: 'ch1', author: 'Diane Marchetti', kind: 'insert', text: 'materially and repeatedly', note: 'Strengthened the breach language.' },
  { id: 'ch2', author: 'Diane Marchetti', kind: 'delete', text: 'we believe', note: 'Removed hedging from a demand.' },
  { id: 'ch3', author: 'Diane Marchetti', kind: 'insert', text: ', as documented in the enclosed performance review,', note: 'Added the cited support.' },
];

export function DocEditor() {
  const [resolved, setResolved] = useState<Record<string, 'accept' | 'reject'>>({});
  const [redlineTaken, setRedlineTaken] = useState(false);
  const pending = CHANGES.filter((c) => !resolved[c.id]);

  function resolve(id: string, how: 'accept' | 'reject') {
    setResolved((r) => ({ ...r, [id]: how }));
  }

  return (
    <div className="kp-page kp-rise" style={{ maxWidth: 1180 }}>
      <div className="kp-page-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="kp-eyebrow">Draft · on your letterhead</div>
          <h1 className="kp-h1" style={{ marginTop: 4 }}>Demand Letter — draft 3</h1>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button className="kp-btn kp-btn--ghost" type="button"><Printer className="kp-ico" strokeWidth={1.75} /> Export PDF</button>
          <button className="kp-btn kp-btn--primary" type="button"><FileText className="kp-ico" strokeWidth={1.75} /> Save .docx</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 312px', gap: 22, alignItems: 'start' }}>
        {/* The page */}
        <div className="kp-card kp-card--raise" style={{ padding: '0 0 40px' }}>
          <div style={{ padding: '34px 56px 0' }}>
            <div style={{ textAlign: 'center', paddingBottom: 18, borderBottom: '2px solid var(--kp-navy)' }}>
              <div style={{ fontFamily: 'var(--kp-doc-serif)', fontSize: 22, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--kp-navy)' }}>MARCHETTI LAW</div>
              <div style={{ fontSize: 11.5, color: 'var(--kp-ink-2)', marginTop: 4, letterSpacing: '0.04em' }}>
                1420 Court Street, Suite 300 · Riverside, CA 92501 · (951) 555-0148
              </div>
            </div>
          </div>
          <div style={{ padding: '26px 56px 0', fontFamily: 'var(--kp-doc-serif)', fontSize: 14.5, lineHeight: 1.85, color: 'var(--kp-ink)' }}>
            <div style={{ color: 'var(--kp-ink-2)', fontFamily: 'var(--kp-sans)', fontSize: 12.5 }}>April 14, 2026 · VIA CERTIFIED MAIL</div>
            <p style={{ marginTop: 18 }}>Re: <i>Brennan v. Vanguard Logistics</i> — Demand for Resolution</p>
            <p style={{ marginTop: 16 }}>Dear Counsel:</p>
            <p style={{ marginTop: 14 }}>
              This firm represents Michael Brennan. The evidence produced in discovery establishes that Vanguard
              Logistics{' '}
              <Ins on={resolved['ch1']}>materially and repeatedly </Ins>
              breached its own progressive-discipline policy. <Del on={resolved['ch2']}>We believe </Del>
              the termination was pretextual<Ins on={resolved['ch3']}>, as documented in the enclosed performance review,</Ins>{' '}
              and that Mr. Brennan’s supervisor reversed his own contemporaneous assessment of satisfactory performance.
            </p>
            <p style={{ marginTop: 14 }}>
              We demand a written response within fourteen (14) days. Absent a good-faith resolution, we are prepared
              to proceed to trial on the wrongful-termination and retaliation claims.
            </p>
            <p style={{ marginTop: 18 }}>Very truly yours,</p>
            <p style={{ fontFamily: 'var(--kp-doc-serif)', marginTop: 10, fontSize: 17, color: 'var(--kp-heading)' }}>Diane Marchetti</p>
            <div style={{ fontFamily: 'var(--kp-sans)', fontSize: 12, color: 'var(--kp-ink-2)' }}>Marchetti Law</div>
          </div>
        </div>

        {/* Reviewing panel */}
        <div style={{ position: 'sticky', top: 8, display: 'grid', gap: 14 }}>
          <div className="kp-card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 15px', borderBottom: '1px solid var(--kp-hairline)' }}>
              <span className="kp-eyebrow">Tracked changes · {pending.length} open</span>
              <button className="kp-btn kp-btn--quiet" type="button" style={{ height: 26, padding: '0 8px', fontSize: 11.5 }}
                onClick={() => setResolved(Object.fromEntries(CHANGES.map((c) => [c.id, 'accept'])))}>
                <CheckCheck className="kp-ico" style={{ width: 14, height: 14 }} strokeWidth={2} /> Accept all
              </button>
            </div>
            <div>
              {CHANGES.map((c) => {
                const state = resolved[c.id];
                return (
                  <div key={c.id} style={{ padding: '12px 15px', borderBottom: '1px solid var(--kp-hairline)', opacity: state ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <span className="kp-avatar" style={{ width: 20, height: 20, fontSize: 9 }}>DM</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--kp-ink)' }}>Diane Marchetti</span>
                      <span className="kp-eyebrow" style={{ marginLeft: 'auto', fontSize: 9, color: c.kind === 'insert' ? 'var(--kp-navy)' : 'var(--kp-danger)' }}>
                        {c.kind === 'insert' ? 'Insertion' : 'Deletion'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--kp-ink-2)', marginBottom: 9 }}>{c.note}</div>
                    {state ? (
                      <div style={{ fontSize: 11.5, color: 'var(--kp-ink-3)', fontStyle: 'italic' }}>{state === 'accept' ? 'Accepted' : 'Rejected'}</div>
                    ) : (
                      <div style={{ display: 'flex', gap: 7 }}>
                        <button className="kp-btn kp-btn--ghost" type="button" style={{ height: 28, padding: '0 11px', fontSize: 12 }} onClick={() => resolve(c.id, 'accept')}>
                          <Check className="kp-ico" style={{ width: 14, height: 14 }} strokeWidth={2} /> Accept
                        </button>
                        <button className="kp-btn kp-btn--quiet" type="button" style={{ height: 28, padding: '0 11px', fontSize: 12 }} onClick={() => resolve(c.id, 'reject')}>
                          <X className="kp-ico" style={{ width: 14, height: 14 }} strokeWidth={2} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI redline suggestion — under the attorney's name */}
          <div className="kp-card" style={{ padding: 15, borderColor: 'var(--kp-direct-line)', background: 'var(--kp-direct-bg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Sparkles className="kp-ico" style={{ width: 16, height: 16, color: 'var(--kp-direct)' }} strokeWidth={1.75} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--kp-direct)' }}>Keepance suggests</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--kp-ink)', lineHeight: 1.55 }}>
              Add a sentence citing the Q2 safety bonus, which the policy limits to employees “in good standing.”
            </div>
            {redlineTaken ? (
              <div style={{ marginTop: 11, fontSize: 12, color: 'var(--kp-local)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check className="kp-ico" style={{ width: 14, height: 14 }} strokeWidth={2.25} /> Inserted as a tracked change under your name.
              </div>
            ) : (
              <button className="kp-btn kp-btn--primary" type="button" style={{ marginTop: 12, width: '100%', justifyContent: 'center', height: 32, fontSize: 12.5 }} onClick={() => setRedlineTaken(true)}>
                Insert as my tracked change
              </button>
            )}
            <div style={{ marginTop: 9, fontSize: 11, color: 'var(--kp-direct)', opacity: 0.85 }}>
              It goes in under “Diane Marchetti,” like an associate’s redline. You accept or reject it.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ins({ children, on }: { children: ReactNode; on?: 'accept' | 'reject' | undefined }) {
  if (on === 'reject') return null;
  if (on === 'accept') return <span>{children}</span>;
  return <span style={{ color: 'var(--kp-navy)', textDecoration: 'underline', textDecorationColor: 'var(--kp-navy-600)', textUnderlineOffset: 2, background: '#e9eef5' }}>{children}</span>;
}
function Del({ children, on }: { children: ReactNode; on?: 'accept' | 'reject' | undefined }) {
  if (on === 'accept') return null;
  if (on === 'reject') return <span>{children}</span>;
  return <span style={{ color: 'var(--kp-danger)', textDecoration: 'line-through', textDecorationColor: 'var(--kp-danger)', background: 'var(--kp-danger-bg)' }}>{children}</span>;
}
