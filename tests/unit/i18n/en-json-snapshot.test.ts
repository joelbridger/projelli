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
        "ask": 135,
        "audio": 1,
        "chat": 12,
        "citation": 3,
        "common": 75,
        "editor": 27,
        "entity-label": 50,
        "file-import": 3,
        "firm": 143,
        "layout": 40,
        "local-ai-download": 9,
        "local-ai-settings": 8,
        "mail": 155,
        "marketplace": 14,
        "matter": 324,
        "media": 100,
        "meetings": 257,
        "memory": 6,
        "model-download": 9,
        "onboarding": 248,
        "plugins": 4,
        "privacy": 35,
        "quick-open": 1,
        "research": 11,
        "scheduling": 56,
        "search": 6,
        "settings": 222,
        "shortcuts-overlay": 2,
        "spine": 10,
        "tab-guard": 3,
        "tts": 1,
        "updater": 2,
        "vault": 53,
        "version": 17,
        "whats-new": 4,
        "whiteboard": 1,
        "workflow": 136,
        "workspace": 54,
      }
    `);
  });

  it('keeps the total leaf-key count consistent with namespace counts', () => {
    const flat = flatten(en as Record<string, JsonValue>);
    // 903 = 900 (Phase 4 solo-to-firm bridge keys) + 2 BUG-099 ready-with-skips
    // plural keys (memory.ready-with-skips_one + _other) + 1 PDF progress key.
    // +17 = Lantern Local AI: local-ai-download (9) + local-ai-settings (8).
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
    // +5 = QA-31 P1 fix: meetings.tab.notes-failed + meetings.entry.{notes-
    //      failed-timeout,notes-failed-error,notes-failed-blocked,retrying-
    //      notes} — an honest failure/retry state for the notes-generation
    //      step, which used to hang forever or fail silently (codex-review
    //      round 2 split the original single generic-failure copy into
    //      distinct timeout vs. error messages).
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
    // +4 = meetings.entry.{transcript-failed-not-installed,transcript-failed-
    //      timeout,transcript-failed-error,retrying-transcript} (QA-40: a
    //      failed transcription used to vanish into a bare catch{} — these
    //      back an honest, classified, retryable failed state, mirroring the
    //      existing notes-failed-* keys).
    // +35 = meetings.notice.* (Recording Notice Kit: the verified-verbal-notice
    //       consent script step, the meeting-page notice trail + resolutions,
    //       invite/chat copy blocks, and the firm Standard/Strict policy dial).
    // +1 = QA-36 client-side create-name guard: workspace.file-tree.reserved-name-error
    //      is the localized inline warning for Windows-reserved/trailing-dot names.
    // +7 = QA-34 .docx save-resilience UI: media.docx-editor.{save-blocked-title,
    //      save-blocked-body,save-retry-now,save-copy-elsewhere,save-copy-saving,
    //      save-copy-success,save-copy-failed} — the sustained-save-failure warning
    //      + "Save a copy elsewhere" escape hatch (P0 silent-data-loss fix).
    // +4 = QA-33 fix (2026-07-04): a stopped Windows credential-storage
    //      service (VaultSvc) used to leave "open this workspace" silently
    //      hung for 30s then fail with only a console.error — no message at
    //      all. New: workspace.open-error.{credential-service-unavailable,
    //      generic,dismiss} (3) surface an honest, dismissible banner instead;
    //      settings.api-keys.credential-service-unavailable (1) does the same
    //      for the (already-gracefully-degrading) AI-key read path.
    // +9 = QA-32 fix (2026-07-04): the native folder/file picker can silently
    //      never respond (root-caused to the modern Windows Common Item
    //      Dialog COM component depending on shell infra a stripped VM may
    //      lack — see dialogWatchdog.ts) — a bounded watchdog now falls back
    //      to a manual path-entry prompt instead of leaving the screen stuck
    //      forever. New: workspace.selector.{picker-unresponsive-open,
    //      picker-unresponsive-create,manual-path-title,manual-path-
    //      placeholder} (4), onboarding.workspace-picker.{picker-
    //      unresponsive-own-data,picker-unresponsive-sample} (2),
    //      file-import.{picker-unresponsive,manual-path-title,manual-path-
    //      placeholder} (3).
    // +3 = QA-35 fix (2026-07-04): the recording pill's "Recording… M:SS"
    //      timer never polled the real backend, so a disk-full chunk-write
    //      failure was invisible to the UI. New: meetings.pill.{write-error,
    //      write-error-dismiss} (2) — the honest "recording can't continue"
    //      pill shown after an auto-stop — and meetings.consent.
    //      low-disk-warning (1), a preflight warning shown in the consent
    //      dialog when free disk space is low.
    // +2 = QA-35 review round 2 (2026-07-04): a disk-full capture_stop that
    //      salvaged NO audio at all left the meeting's notes/transcript
    //      panes stuck at "pending" forever (nothing was ever asked to
    //      generate them) instead of an honest dead end. New: meetings.tab.
    //      recording-incomplete (1, the meetings-list row subtitle) and
    //      meetings.entry.recording-incomplete (1, the meeting page's
    //      no-retry explanation).
    // +1 = QA-47 fix (2026-07-05): MeetingEntry's notes.docx editor now loads
    //      through LazyBoundary (same pattern as MainPanel's DocxEditor tabs)
    //      instead of a bare import().then() with no .catch, so a chunk-load
    //      failure surfaces a real retry state instead of a false "notes
    //      pending". New: meetings.entry.docx-editor-label (1, the
    //      LazyBoundary label).
    // +17 = Tier B trust guards (2026-07-04, merged in from origin/lantern-plus):
    //       meetings.speakers.{consent-label,consent-biometric-note} (2, R9);
    //       ask.whole-practice-confirm.{title,body_one,body_other,provider-
    //       fallback,remember,cancel,continue} (7, R6);
    //       matter.crm-review.{provenance-from-meeting,provenance-drafted,
    //       provenance-advisor-fallback} (3, E3 provenance);
    //       media.docx-editor.{outbound-blocked-needs-review,outbound-blocked-
    //       errored,outbound-blocked-notice-quarantined} (3, E3 outbound gate);
    //       media.docx-editor.outbound-blocked-checking (1, E3 fail-closed: the
    //       gate blocks a recognized meeting note while its review state loads);
    //       meetings.speakers.consent-save-failed (1, R9 fail-closed: enrollment
    //       aborts if the biometric-consent record didn't durably persist).
    // +31 = meetings.notice-card.* (the Notice Card lane, merged in from
    //       origin/lantern-plus: the local notice participant —
    //       consent-dialog offer/toggle + platform labels + Meet/generic/
    //       manual fallbacks + Zoom native-record self-attest, the
    //       record-pill status line, the visual card copy, the 3 Notice Card
    //       settings controls, and the "save recording background image" action).
    // +2 = QA-71 fix (2026-07-05): meetings.entry gained no-transcript
    //      delete-audio button/body copy so deleting audio before transcript
    //      exists honestly warns that the only meeting copy will be lost.
    // +5 = R2/R4 branch key inventory catch-up: matter +4 from existing branch
    //      drift, spine.all-clients +1 for the permanent rail entry.
    // +20 = R5 Ask layout: answer-scope popover copy + Book Overview helper +
    //       the review-driven i18n sweep (conversation search, pane labels,
    //       source-preview copy moved from hardcoded English to keys).
    // +2 = R3 navigation: rail-search empty state + Back button label.
    // +17 = R7 Meetings: detail sub-tabs/export/rename copy (15) + spoken announcement phrases (2).
    // +16 = MF1 meeting recipients: per-artifact recipient picker labels, helper copy,
    //       save/add/remove controls, validation, and saved/saving status text.
    // +9 = send-defaults feedback: invite-attendee auto-include copy and client-scoped
    //      recipient groups (auto title/body, add-person, group title/body/name,
    //      save/saved, use-group).
    // +34 = MF2/MF3 meeting send + auto-join: reviewed send UI, email
    //       delivery status/log copy, and calendar-driven auto-join panel copy.
    // +2 = FB-F client header: History panel title and close label.
    // +3 = Documents vertical rail: group rename, ungroup, and close-group menu labels.
    // +2 = this batch's merge: meetings "Send to team" tab + documents rail
    //      close-other-tabs (each branch counted only its own keys; the true
    //      combined total is both).
    // +3 = F1 single-source egress (UX lane L0): workflow.associate.egress-{local,
    //      cloud,none} — the quiet TrustNote line above Run that replaced the
    //      duplicate egress status pill in the workflow template detail.
    // +2 = F1 fix round 1: privacy.egress.local-pending.{label,note} — the honest
    //      "Local AI setting up" badge state (item 3), never a false "Using local AI".
    // +20 = FB2 railchrome: shared rail headers, search toggles, collapse labels,
    //       and rail action menu labels across Ask, Mail, Client Map, Meetings,
    //       Settings, Workflows, and Documents.
    // Merged demo build = onboarding reframe (V2 intro, start choice, compliance
    // beat, AI provider setup, connector copy, firm-progress labels, example
    // questions) + Calendly-style scheduling (Settings Scheduling section +
    // Phase 2 advisor surface: top-bar entry, rail labels, booking-link actions,
    // request statuses, availability controls, meeting-type panel, slot preview).
    const counts = namespaceCounts(en as Record<string, JsonValue>);
    expect(flat.length).toBe(Object.values(counts).reduce((sum, count) => sum + count, 0));
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
