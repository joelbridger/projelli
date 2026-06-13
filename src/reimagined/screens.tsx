/**
 * Reimagined-UI prototype screens. Each screen traces to a research finding in
 * docs/research/2026-06-13-ui-reimagining/. Mock data only.
 */
import { useState } from 'react';
import {
  Sparkles, ArrowRight, CheckCircle2, FileText, ExternalLink, ListChecks,
  Download, Quote, Mail, Clock, ShieldCheck, Lock, ArrowUpRight, Scale,
} from 'lucide-react';
import {
  MATTERS, DOCS, TIMELINE, CONTRADICTIONS, ASK_EXAMPLE, TRUST_MAP,
  type Matter, type Citation,
} from './data';

const STATUS_PILL: Record<Matter['status'], { cls: string; label: string }> = {
  open: { cls: 'kp-pill--open', label: 'Open' },
  pending: { cls: 'kp-pill--pending', label: 'Pending' },
  closed: { cls: 'kp-pill--closed', label: 'Closed' },
};

/* ----------------------------- Matters home ----------------------------- */
export function MattersHome({ onOpenMatter }: { onOpenMatter: (id: string) => void }) {
  const open = MATTERS.filter((m) => m.status !== 'closed').length;
  return (
    <div className="kp-page kp-rise">
      <div className="kp-page-head">
        <div>
          <div className="kp-eyebrow">Marchetti Law</div>
          <h1 className="kp-h1">Matters</h1>
          <div className="kp-h1-sub">{open} open · everything you are working on, organized the way your practice is.</div>
        </div>
        <button className="kp-btn kp-btn--primary" type="button">
          <Scale className="kp-ico" strokeWidth={1.75} /> New matter
        </button>
      </div>

      <div className="kp-card">
        <div className="kp-matters-head" style={{ paddingTop: 14 }}>
          <span>Matter</span>
          <span>Practice area</span>
          <span>Status</span>
          <span>Last activity</span>
        </div>
        <div className="kp-matters-list">
          {MATTERS.map((m) => {
            const pill = STATUS_PILL[m.status];
            return (
              <button key={m.id} type="button" className="kp-matter-row" onClick={() => onOpenMatter(m.id)}>
                <div>
                  <div className="kp-mr-title">{m.title}</div>
                  <div className="kp-mr-client">
                    {m.client} <span className="kp-mr-num">· {m.number}</span>
                  </div>
                </div>
                <div className="kp-mr-area">{m.area}</div>
                <div>
                  <span className={`kp-pill ${pill.cls}`}><span className="kp-pill-dot" />{pill.label}</span>
                </div>
                <div className="kp-mr-when">{m.lastActivity}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Matter overview ---------------------------- */
export function MatterOverview({ matter, onTab }: { matter: Matter; onTab: (t: string) => void }) {
  return (
    <div className="kp-page kp-rise">
      <div className="kp-tiles" style={{ marginBottom: 22 }}>
        {[
          { k: matter.docs.toLocaleString(), l: 'Documents indexed' },
          { k: matter.emails.toLocaleString(), l: 'Emails, searchable' },
          { k: String(matter.drafts), l: 'Drafts on letterhead' },
          { k: '38', l: 'Scanned pages (OCR)' },
        ].map((t) => (
          <div key={t.l} className="kp-card kp-tile">
            <div className="kp-tile-k">{t.k}</div>
            <div className="kp-tile-l">{t.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 22, alignItems: 'start' }}>
        <div>
          <h2 className="kp-h2" style={{ marginBottom: 12 }}>Pick up where you left off</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <ActionCard
              Icon={Sparkles}
              title="Ask this matter"
              body="Find anything across the file in seconds. Every answer cites the source you can click."
              cta="Ask a question"
              onClick={() => onTab('ask')}
            />
            <ActionCard
              Icon={ListChecks}
              title="Find where the witness contradicts himself"
              body="The associate read the Whitmore deposition against the production and flagged 4 candidates to verify."
              cta="Open the analysis"
              badge="4 candidates"
              onClick={() => onTab('associate')}
            />
            <ActionCard
              Icon={FileText}
              title="Demand Letter — draft 3"
              body="On your letterhead, with tracked changes. Last edited today."
              cta="Open in the editor"
              onClick={() => onTab('drafts')}
            />
          </div>
        </div>

        <div>
          <h2 className="kp-h2" style={{ marginBottom: 12 }}>Recent activity</h2>
          <div className="kp-card" style={{ padding: '6px 0' }}>
            {TIMELINE.map((t) => (
              <div key={t.id} style={{ display: 'flex', gap: 11, padding: '11px 16px', borderBottom: '1px solid var(--kp-hairline)' }}>
                <Clock className="kp-ico" style={{ width: 15, height: 15, color: 'var(--kp-ink-3)', marginTop: 2, flex: 'none' }} strokeWidth={1.75} />
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--kp-ink)' }}>{t.text}</div>
                  <div style={{ fontSize: 11, color: 'var(--kp-ink-3)', marginTop: 2 }}>
                    <span className="kp-eyebrow" style={{ fontSize: 9.5 }}>{t.kind}</span> · {t.when}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionCard({ Icon, title, body, cta, badge, onClick }: {
  Icon: typeof Sparkles; title: string; body: string; cta: string; badge?: string; onClick: () => void;
}) {
  return (
    <button type="button" className="kp-card" onClick={onClick}
      style={{ display: 'flex', gap: 14, padding: 16, textAlign: 'left', cursor: 'pointer', alignItems: 'flex-start' }}>
      <span style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--kp-paper-2)', display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Icon className="kp-ico" style={{ width: 19, height: 19, color: 'var(--kp-navy)' }} strokeWidth={1.75} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="kp-serif" style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--kp-ink)' }}>{title}</span>
          {badge && <span className="kp-pill kp-pill--pending"><span className="kp-pill-dot" />{badge}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--kp-ink-2)', marginTop: 4, lineHeight: 1.5 }}>{body}</div>
        <div style={{ fontSize: 12.5, color: 'var(--kp-navy)', fontWeight: 600, marginTop: 9, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {cta} <ArrowRight className="kp-ico" style={{ width: 14, height: 14 }} strokeWidth={2} />
        </div>
      </div>
    </button>
  );
}

/* ------------------------- Citation-aware answer ------------------------- */
function CitationText({ text, citations, selected, onSelect }: {
  text: string; citations: Citation[]; selected: number | null; onSelect: (n: number) => void;
}) {
  const parts = text.split(/(\{\d+\})/g);
  return (
    <p style={{ fontSize: 15, lineHeight: 1.72, color: 'var(--kp-ink)' }}>
      {parts.map((p, i) => {
        const m = p.match(/^\{(\d+)\}$/);
        if (!m) return <span key={i}>{p}</span>;
        const n = Number(m[1]);
        const c = citations.find((x) => x.n === n);
        const isSel = selected === n;
        return (
          <button
            key={i}
            type="button"
            className={`kp-cite ${c?.verified ? 'kp-cite--verified' : ''}`}
            style={isSel ? { outline: '2px solid var(--kp-navy)', outlineOffset: 1 } : undefined}
            onClick={() => onSelect(n)}
            aria-label={`Citation ${n}: ${c?.doc}, ${c?.locator}. ${c?.verified ? 'Verified.' : ''}`}
          >
            {c?.verified && <CheckCircle2 className="kp-ico" strokeWidth={2.25} />}
            {n}
          </button>
        );
      })}
    </p>
  );
}

/* -------------------------------- Ask ----------------------------------- */
export function AskScreen({ matter }: { matter: Matter | null }) {
  const [selected, setSelected] = useState<number | null>(1);
  const cite = ASK_EXAMPLE.citations.find((c) => c.n === selected) ?? ASK_EXAMPLE.citations[0]!;
  const scope = matter ? matter.title : 'all matters';

  return (
    <div className="kp-page kp-rise" style={{ maxWidth: 1140 }}>
      <div className="kp-eyebrow">Ask · {scope}</div>
      <h1 className="kp-h1" style={{ marginTop: 4 }}>Find anything, and click to verify it.</h1>

      <div className="kp-card kp-card--raise" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 6px 4px 16px', margin: '16px 0 24px' }}>
        <Sparkles className="kp-ico" style={{ width: 19, height: 19, color: 'var(--kp-navy)', flex: 'none' }} strokeWidth={1.75} />
        <input
          defaultValue={ASK_EXAMPLE.question}
          aria-label="Ask a question about this matter"
          style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: 14.5, color: 'var(--kp-ink)', padding: '11px 0', fontFamily: 'var(--kp-sans)' }}
        />
        <button className="kp-btn kp-btn--primary" type="button">
          Ask <ArrowRight className="kp-ico" strokeWidth={2} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 26, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
            <Quote className="kp-ico" style={{ width: 16, height: 16, color: 'var(--kp-ink-3)' }} strokeWidth={1.75} />
            <span className="kp-serif" style={{ fontSize: 16, color: 'var(--kp-ink-2)', fontStyle: 'italic' }}>{ASK_EXAMPLE.question}</span>
          </div>
          <CitationText text={ASK_EXAMPLE.answer} citations={ASK_EXAMPLE.citations} selected={selected} onSelect={setSelected} />
          <div style={{ marginTop: 18, padding: '10px 14px', borderRadius: 8, background: 'var(--kp-local-bg)', border: '1px solid var(--kp-local-line)', display: 'flex', gap: 9, alignItems: 'center', fontSize: 12.5, color: 'var(--kp-local)' }}>
            <ShieldCheck className="kp-ico" style={{ width: 16, height: 16 }} strokeWidth={2} />
            Answered on your machine, over your own files. Every claim above is cited and was checked against the source.
          </div>
        </div>

        {/* Source panel: click-to-verify */}
        <div className="kp-card" style={{ position: 'sticky', top: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--kp-hairline)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="kp-eyebrow">Source · citation {cite.n}</span>
            {cite.verified && (
              <span className="kp-pill kp-pill--open" style={{ marginLeft: 'auto' }}><CheckCircle2 className="kp-ico" style={{ width: 12, height: 12 }} strokeWidth={2.25} />Verified</span>
            )}
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <FileText className="kp-ico" style={{ width: 17, height: 17, color: 'var(--kp-navy)', marginTop: 1, flex: 'none' }} strokeWidth={1.75} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--kp-ink)', lineHeight: 1.35 }}>{cite.doc}</div>
                <div className="kp-mono" style={{ fontSize: 11.5, color: 'var(--kp-ink-2)', marginTop: 3 }}>{cite.locator} · {cite.date}</div>
              </div>
            </div>
            <blockquote style={{ margin: '14px 0 0', padding: '11px 14px', borderLeft: '3px solid var(--kp-accent)', background: 'var(--kp-paper-2)', borderRadius: '0 7px 7px 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--kp-ink)' }}>
              {cite.excerpt}
            </blockquote>
            <button className="kp-btn kp-btn--ghost" type="button" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>
              <ExternalLink className="kp-ico" strokeWidth={1.75} /> Open full document
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Litigation associate ------------------------ */
export function AssociateScreen({ matter }: { matter: Matter }) {
  const [open, setOpen] = useState<string | null>(CONTRADICTIONS[0]?.id ?? null);
  return (
    <div className="kp-page kp-rise">
      <div className="kp-page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="kp-eyebrow">The litigation associate · {matter.title}</div>
          <h1 className="kp-h1" style={{ marginTop: 4 }}>Find where the witness contradicts himself</h1>
          <div className="kp-h1-sub">Read the Whitmore deposition against the production and prior statements. 4 candidates, each cited on both sides.</div>
        </div>
        <button className="kp-btn kp-btn--ghost" type="button"><Download className="kp-ico" strokeWidth={1.75} /> Export to Word</button>
      </div>

      <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: 'var(--kp-direct-bg)', border: '1px solid var(--kp-direct-line)', color: 'var(--kp-direct)', fontSize: 12.5, marginBottom: 18 }}>
        <Scale className="kp-ico" style={{ width: 16, height: 16 }} strokeWidth={2} />
        <span><b>You verify, you decide.</b> These are candidates a tireless first-year flagged for you, not conclusions. Click any one to read both passages.</span>
      </div>

      <div className="kp-card" style={{ overflow: 'hidden' }}>
        {CONTRADICTIONS.map((c, i) => {
          const isOpen = open === c.id;
          return (
            <div key={c.id} style={{ borderBottom: i < CONTRADICTIONS.length - 1 ? '1px solid var(--kp-hairline)' : 'none' }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : c.id)}
                style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 13, alignItems: 'center', width: '100%', textAlign: 'left', background: isOpen ? 'var(--kp-paper-2)' : 'transparent', border: 0, padding: '14px 18px', cursor: 'pointer' }}>
                <span className="kp-mono" style={{ fontSize: 13, color: 'var(--kp-ink-3)' }}>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--kp-ink)', fontFamily: 'var(--kp-serif)' }}>{c.topic}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--kp-ink-2)', marginTop: 2 }}>{c.summary}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {c.verified
                    ? <span className="kp-pill kp-pill--open"><CheckCircle2 className="kp-ico" style={{ width: 12, height: 12 }} strokeWidth={2.25} />Cited both sides</span>
                    : <span className="kp-pill kp-pill--pending"><span className="kp-pill-dot" />Check the prior doc</span>}
                </div>
              </button>
              {isOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, padding: '4px 18px 18px 55px' }}>
                  <SidePassage label="Deposition testimony" doc={matter.title} locator={c.depoLocator} quote={c.depoQuote} tone="depo" />
                  <SidePassage label="Prior statement" doc={c.priorDoc} locator={c.priorLocator} quote={c.priorQuote} tone="prior" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidePassage({ label, doc, locator, quote, tone }: { label: string; doc: string; locator: string; quote: string; tone: 'depo' | 'prior' }) {
  const accent = tone === 'depo' ? 'var(--kp-navy)' : 'var(--kp-accent)';
  return (
    <div className="kp-card" style={{ padding: 13, borderColor: 'var(--kp-hairline)' }}>
      <div className="kp-eyebrow" style={{ color: accent }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '7px 0 9px' }}>
        <FileText className="kp-ico" style={{ width: 14, height: 14, color: 'var(--kp-ink-3)' }} strokeWidth={1.75} />
        <span style={{ fontSize: 12, color: 'var(--kp-ink-2)' }}>{doc}</span>
        <span className="kp-cite kp-cite--verified" style={{ marginLeft: 'auto' }}><CheckCircle2 className="kp-ico" strokeWidth={2.25} />{locator}</span>
      </div>
      <blockquote style={{ margin: 0, padding: '9px 12px', borderLeft: `3px solid ${accent}`, background: 'var(--kp-paper-2)', borderRadius: '0 6px 6px 0', fontSize: 13, lineHeight: 1.55, color: 'var(--kp-ink)' }}>
        “{quote}”
      </blockquote>
    </div>
  );
}

/* ------------------------------ Documents ------------------------------- */
export function MatterDocuments() {
  return (
    <div className="kp-page kp-rise">
      <div className="kp-page-head">
        <div><div className="kp-eyebrow">Documents</div><h1 className="kp-h1" style={{ marginTop: 4 }}>The file</h1></div>
        <button className="kp-btn kp-btn--ghost" type="button"><FileText className="kp-ico" strokeWidth={1.75} /> Add documents</button>
      </div>
      <div className="kp-card">
        <div className="kp-matters-head" style={{ gridTemplateColumns: '1fr 132px 120px 110px 96px', paddingTop: 14 }}>
          <span>Document</span><span>Kind</span><span>Author</span><span>Date</span><span>Recall</span>
        </div>
        {DOCS.map((d) => (
          <div key={d.id} className="kp-matter-row" style={{ gridTemplateColumns: '1fr 132px 120px 110px 96px', cursor: 'default' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {d.privileged ? <Lock className="kp-ico" style={{ width: 15, height: 15, color: 'var(--kp-danger)' }} strokeWidth={1.75} />
                : d.kind === 'Email' ? <Mail className="kp-ico" style={{ width: 15, height: 15, color: 'var(--kp-ink-3)' }} strokeWidth={1.75} />
                : <FileText className="kp-ico" style={{ width: 15, height: 15, color: 'var(--kp-ink-3)' }} strokeWidth={1.75} />}
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 550, color: 'var(--kp-ink)' }}>{d.name}</div>
                {d.privileged && <span className="kp-pill kp-pill--privilege" style={{ marginTop: 4 }}><Lock className="kp-ico" style={{ width: 10, height: 10 }} strokeWidth={2} />Privileged</span>}
              </div>
            </div>
            <div className="kp-mr-area">{d.kind}</div>
            <div className="kp-mr-area">{d.author}</div>
            <div className="kp-mr-when">{d.date}</div>
            <div>{d.analyzed ? <span className="kp-pill kp-pill--open"><span className="kp-pill-dot" />Indexed</span> : <span className="kp-mr-when">—</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Trust Map ------------------------------- */
export function TrustMapContent() {
  return (
    <div>
      <div style={{ display: 'grid', gap: 10 }}>
        {[
          { Icon: Lock, t: 'Your files stay on this computer', s: 'In a folder you chose. Keepance never uploads them.' },
          { Icon: ShieldCheck, t: 'Your AI account key lives in your OS keychain', s: 'Encrypted by your operating system. We never store it.' },
          { Icon: ArrowUpRight, t: 'Cloud questions go straight to your provider', s: 'When you use a cloud AI, the question goes to them from your device. We never see it. They keep it ~30 days by default; you can turn that off in your account.' },
          { Icon: Mail, t: 'Imported email is encrypted on this computer', s: 'Keepance’s servers never receive a copy.' },
          { Icon: ShieldCheck, t: 'Our servers only ever see a license check', s: 'Nothing about your matters or clients.' },
        ].map((r) => (
          <div key={r.t} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 9, background: 'var(--kp-surface)', border: '1px solid var(--kp-hairline)' }}>
            <r.Icon className="kp-ico" style={{ width: 18, height: 18, color: 'var(--kp-navy)', marginTop: 1, flex: 'none' }} strokeWidth={1.75} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--kp-ink)' }}>{r.t}</div>
              <div style={{ fontSize: 12.5, color: 'var(--kp-ink-2)', marginTop: 2, lineHeight: 1.5 }}>{r.s}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="kp-eyebrow" style={{ marginBottom: 8 }}>This matter, document by document</div>
        <div className="kp-card" style={{ overflow: 'hidden' }}>
          {TRUST_MAP.map((r, i) => (
            <div key={r.doc} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '11px 14px', borderBottom: i < TRUST_MAP.length - 1 ? '1px solid var(--kp-hairline)' : 'none', fontSize: 12.5 }}>
              <div style={{ color: 'var(--kp-ink)', fontWeight: 550 }}>{r.doc}</div>
              <div style={{ color: 'var(--kp-ink-2)' }}>{r.storage} · {r.processing}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
