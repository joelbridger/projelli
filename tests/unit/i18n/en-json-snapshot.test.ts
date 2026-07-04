// Snapshot test for en.json structure. Locks the namespace shape and key
// inventory so that future PRs adding or removing keys show up clearly in
// review diffs. The translation pipeline (Group IV) and locale detection
// (Group VI) both depend on this shape, so unintentional drift here would
// silently break the cascade.
//
// Update procedure when keys legitimately change:
//   1. Add or remove keys via t() calls in components.
//   2. Add or remove the key in src/locales/en.json.
//   3. Run `npm run test -- en-json-snapshot --update` to refresh the snapshot.
//   4. Re-run `npm run translate-i18n` to propagate to es.json + de.json.
import { describe, it, expect } from 'vitest';
import en from '@/locales/en.json';

type JsonValue = string | { [key: string]: JsonValue };

function flatten(obj: Record<string, JsonValue>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      out.push(...flatten(v as Record<string, JsonValue>, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

function namespaceCounts(obj: Record<string, JsonValue>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [ns, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null) {
      counts[ns] = flatten(val as Record<string, JsonValue>).length;
    } else {
      counts[ns] = 1;
    }
  }
  return counts;
}

describe('en.json structure snapshot', () => {
  it('matches the expected namespace inventory', () => {
    const counts = namespaceCounts(en as Record<string, JsonValue>);
    expect(counts).toMatchInlineSnapshot(`
      {
        "ai": 48,
        "analysis": 10,
        "app": 2,
        "ask": 23,
        "audio": 1,
        "chat": 12,
        "citation": 3,
        "common": 49,
        "editor": 14,
        "entity-label": 50,
        "firm": 143,
        "layout": 40,
        "local-ai-download": 9,
        "local-ai-settings": 8,
        "mail": 6,
        "marketplace": 14,
        "matter": 206,
        "media": 81,
        "meetings": 62,
        "memory": 6,
        "model-download": 9,
        "onboarding": 65,
        "plugins": 4,
        "privacy": 31,
        "quick-open": 1,
        "research": 11,
        "search": 6,
        "settings": 167,
        "shortcuts-overlay": 2,
        "spine": 5,
        "tab-guard": 3,
        "tts": 1,
        "updater": 2,
        "vault": 53,
        "version": 17,
        "whats-new": 4,
        "whiteboard": 1,
        "workflow": 29,
        "workspace": 12,
      }
    `);
  });

  it('locks the total leaf-key count', () => {
    const flat = flatten(en as Record<string, JsonValue>);
    // 903 = 900 (Phase 4 solo-to-firm bridge keys) + 2 BUG-099 ready-with-skips
    // plural keys (memory.ready-with-skips_one + _other) + 1 PDF progress key.
    // +17 = Keepance Local AI: local-ai-download (9) + local-ai-settings (8).
    // +2 = privacy.egress.checking.{label,note} (local-status "Checking" badge).
    // +2 = privacy.egress.none.{label,note} (UX-01 "No AI connected" badge).
    // +1 = matter.manager.client-name-helper (UX tidy-up: optional company field helper).
    // +14 = common.ai-setup-help.* (the "I need help setting this up" ticket).
    // +1 = media.docx-editor.concurrent-edit-conflict (CLUSTER-C2 drift guard).
    // +2 = media.docx-editor.draft-follow-up{,-title} (Wave 0 draft-follow-up button).
    // +2 = matter.notes.{send-to-wealthbox,sent-to-wealthbox} (Wave 2 CRM write-back enqueue action).
    // +1 = media.docx-editor.send-to-wealthbox-disconnected (smoke P0 #5 fix: discoverable
    //      Send to Wealthbox action on normal docx notes, disabled-with-explanation state).
    // +18 = matter.book.* (14) + matter.beneficiary.* (2) (Wave 4 Track B: Book view + estate/beneficiary gap chips).
    // +12 = ask.scope-pill.* (5) + ask.book.* (7) (Wave 4 Track C: whole-practice Ask).
    // +17 = meetings.speakers.* (9) + matter.voiceprints.* (8) (Wave 4 Track A: speaker naming panel + voice profiles card).
    // +16 = privacy.retention.* (Wave 4 Track D: retention policy settings + Data Map row + attestation export).
    // (Tracks A and D merged independently; 975 base + 17 + 16 = 1008.)
    // +3 = common.audit-log.integrity-seal-missing{,-detail,-detail-notime}
    //      (audit-chain fail-closed: honest surfacing of the missing-seal state).
    // +4 = common.audit-log.repair-{action,confirm-title,confirm-body,confirm-cta}
    //      (explicit acknowledged repair affordance on the seal-missing badge).
    // +1 = common.audit-log.repair-failed (surface a failed repair honestly).
    // +34 = meetings.pill.* (1) + meetings.tab.* (10) + meetings.entry.* (9) +
    //       meetings.types.* (3) + meetings.consent.* (11) (Wave 3c: the
    //       user-facing Meetings tab surface — record pill, per-client
    //       meetings list + needs-review, meeting page, meeting-type chip,
    //       consent dialog).
    // +4 = meetings.dictation.* (Task 10b: "File as meeting note…" client picker).
    // +1 = matter.notes.review-now (QA finding P3: actionable "Review now"
    //      action next to the Send-to-Wealthbox confirmation).
    // +3 = matter.crm-review.{pending-banner_one,pending-banner_other,review-now}
    //      (QA finding P2: hub-chrome pending-review banner on non-overview
    //      sub-tabs, since CrmWriteReviewCard only ever mounted on Overview).
    // +12 net = 2026-07-04 Meetings UX review polish: meetings.pill +4
    //      (recording-label, local, local-tooltip, processing), meetings.tab
    //      +5/−4 (record-note, loading, needs-review-badge, reviewed-badge,
    //      duration; removed the needs-review queue-box strings — badges on
    //      rows now), meetings.entry +5 (generic-title, dictated-title,
    //      delete-audio-confirm-*), meetings.consent +2
    //      (two-party-note-unknown, start-failed).
    // +55 = QA-14 i18n fix (2026-07-04): Spine's primary nav, MatterHub's hub
    //      tabs, and MattersHome's row/toolbar actions used literal strings
    //      instead of t(), so switching locale never touched them. New:
    //      spine.* (5), matter.hub.* (17), matter.home.* (23, including the
    //      folder-count and folder-suffix plural pairs and the get-started
    //      onboarding-card keys), ask.scope-toggle.* (3, ScopeToggle's own
    //      "This X" / "All X" pills sat right next to ask.scope-pill.* with
    //      the same disease).
    // +3 = meetpersist P1 fix (2026-07-04): meetings.tab gained scan-error-title/
    //      scan-error-body/retry-button — a failed disk scan now renders a
    //      distinct error state instead of masquerading as "No meetings yet".
    // +3 = tab-guard.* (title, description, take-over) — QA-15 browser-build
    //      single-writer tab gate ("this workspace is open in another tab").
    // +50 = entity-label.* (cleanup batch 2, 2026-07-04): useEntityLabel()
    //      returned hardcoded English words for the profession-pack noun
    //      (matter/client/engagement/household) regardless of locale. New:
    //      entity-label.{legal,tax,consulting,advisor,other}.* (10 fields
    //      each: one, other, one-cap, other-cap, household, households,
    //      household-cap, households-cap, confidentiality-column,
    //      confidentiality-badge).
    // +27 = cleanup2 follow-up (2026-07-04): fixed mixed-language sentences on
    //      the primary Ask + client-manager surfaces (the entity-label noun
    //      is now translated, but the surrounding sentence stayed hardcoded
    //      English at ~50 call sites — a real coherence regression flagged in
    //      review). New: ask.composer.* (2), ask.file-access.* (1),
    //      ask.message-scope.* (3), ask.sample-bridge.* (2) = 8;
    //      matter.manager.*-entity (15) + matter.scope.*-entity (4) = 19.
    //      The remaining ~23 hardcoded-English call sites (audit, email,
    //      workflows, the privacy report, and TrustBar) were left as-is and
    //      now read via useEntityLabelEnglish() instead, so no sentence ships
    //      mixed-language; see the cleanup2 handoff for the exact file list.
    // +2 = matter.manager.{remove-action,cancel-action} (codex-review finding:
    //      the delete-client confirm dialog's title/body were localized above
    //      but its own confirm/cancel BUTTONS stayed hardcoded "Remove"/
    //      "Cancel" — same mixed-language bug, one level down).
    expect(flat.length).toBe(1210);
  });

  it('every namespace key follows lowercase kebab-case', () => {
    const flat = flatten(en as Record<string, JsonValue>);
    const stripPlural = (segment: string): string => {
      for (const suffix of ['_one', '_other', '_few', '_many', '_zero', '_two']) {
        if (segment.endsWith(suffix)) {
          return segment.slice(0, -suffix.length);
        }
      }
      return segment;
    };
    const segmentRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    const violations: string[] = [];
    for (const key of flat) {
      for (const seg of key.split('.')) {
        if (!segmentRe.test(stripPlural(seg))) {
          violations.push(`${key} (segment: ${seg})`);
          break;
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('every leaf value is a non-empty string', () => {
    const stack: Array<[string, JsonValue]> = Object.entries(en).map(
      ([k, v]) => [k, v as JsonValue],
    );
    while (stack.length > 0) {
      const [key, val] = stack.pop()!;
      if (typeof val === 'object' && val !== null) {
        for (const [k, v] of Object.entries(val)) {
          stack.push([`${key}.${k}`, v as JsonValue]);
        }
      } else {
        expect(typeof val, `key ${key} should be string`).toBe('string');
        expect((val as string).length, `key ${key} should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it('contains no em dashes (rule: NO em dashes anywhere)', () => {
    const stack: Array<[string, JsonValue]> = Object.entries(en).map(
      ([k, v]) => [k, v as JsonValue],
    );
    const offenders: string[] = [];
    while (stack.length > 0) {
      const [key, val] = stack.pop()!;
      if (typeof val === 'object' && val !== null) {
        for (const [k, v] of Object.entries(val)) {
          stack.push([`${key}.${k}`, v as JsonValue]);
        }
      } else if (typeof val === 'string' && val.includes('—')) {
        offenders.push(key);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('plural keys come in matching _one + _other pairs', () => {
    const flat = flatten(en as Record<string, JsonValue>);
    const oneKeys = flat.filter((k) => k.endsWith('_one'));
    const otherKeys = new Set(flat.filter((k) => k.endsWith('_other')));
    const missing: string[] = [];
    for (const oneKey of oneKeys) {
      const base = oneKey.slice(0, -'_one'.length);
      if (!otherKeys.has(`${base}_other`)) {
        missing.push(oneKey);
      }
    }
    expect(missing, 'every _one key needs a matching _other').toEqual([]);
  });
});
