# i18n Review Process

How the Spanish + German translations get reviewed, locked, and updated over time.

## Background

Stream E (v2.0) shipped 421 user-facing English keys, machine-translated to Spanish and German via `npm run translate-i18n`. Machine translation is good enough to ship, but native speakers will catch awkward phrasing, gendered language mismatches, and tone issues that the model can't see.

This doc covers two review modes:

1. **Light review by Jameson** — solo eyeball pass on visible UI strings.
2. **Community review** — accepting PRs from native speakers.

## File layout (refresher)

- `src/locales/en.json` — source of truth. Edit here when you want to change English copy.
- `src/locales/es.json` — Spanish. Generated. Lock individual keys to protect human edits.
- `src/locales/de.json` — German. Same pattern as `es.json`.
- `scripts/translate-i18n.mjs` — hash-incremental LLM translator. Re-runs only translate keys whose English source changed and whose `__locked` flag is not `true`.
- `scripts/lock-translation.mjs` — helper to flip `__locked: true` on one key.

Full conventions live in `src/locales/README.md`.

## Mode 1: light review by Jameson

The fastest path. Best done in chunks of one namespace at a time (e.g. all of `chat.*`, then all of `settings.*`).

1. Switch the running app to the locale you're reviewing (Settings → General → Language → Español or Deutsch).
2. Click through the surfaces you're auditing.
3. When a string looks wrong, edit `src/locales/<locale>.json` directly. Keep the JSON valid.
4. Lock your edit so the next translation run won't overwrite it:

   ```bash
   node scripts/lock-translation.mjs es chat.input.send-button
   ```

5. Commit en bloc when the review pass for that namespace is done.

The lock script validates the key exists and is a leaf string. Running it twice on the same key is a no-op.

If you want to *change* an existing locked translation, just edit the JSON value. The lock stays in place.

If you want to *unlock* a key (rare, usually because the English source changed and you want the model to retranslate), delete the `__locked: true` sibling line by hand.

## Mode 2: community review (PRs)

Once the product has Spanish and German users, they will offer to fix translations. The workflow:

### Inviting reviewers

- Add a one-paragraph note to the project README pointing native speakers to this doc.
- Pin a GitHub issue titled "Translation review wanted: Spanish / German" with instructions.
- Mention `src/locales/<locale>.json` and the lock convention. Most translators have never seen a JSON locale file with hash siblings, so explain that they can ignore the `__sourceHash` and `__locked` lines and only edit string values.

### Reviewing community PRs

When a PR touches `src/locales/es.json` or `src/locales/de.json`:

1. **Verify the PR only touches the locale file(s).** If it bundles unrelated changes, ask the contributor to split.
2. **Verify JSON validity.** GitHub's diff view will fail to render if the JSON is broken. Locally:

   ```bash
   node -e "JSON.parse(require('fs').readFileSync('src/locales/es.json'))"
   ```

3. **Verify no metadata vandalism.** Search the diff for `__sourceHash` or `__locked` changes. The contributor should not be touching those. If they did, ask why; usually it's accidental.
4. **Run the test suite locally on the PR branch.** `npm run test -- locale-smoke` is the targeted check; full `npm run test` catches anything else.
5. **Lock the contributor's edits before merging.** This protects their work from the next `npm run translate-i18n` run. For each key they touched:

   ```bash
   node scripts/lock-translation.mjs es path.to.key
   ```

   Commit the lock changes on top of their PR (or amend with their permission), then merge.
6. **Credit the reviewer in the merge commit message.** Translation work is invisible labor; name them.

### Conflict between two community reviewers

If two reviewers disagree on the same string, the PR with the lock wins by default (it landed first and is now protected). Reopen the conversation in a new issue if the second reviewer feels strongly. Don't let the same key bounce between PRs.

## When the source English changes

If you change a string in `en.json`, the next `npm run translate-i18n` run will:

- Detect the source-hash change for that key.
- Re-translate it for any locale where `__locked` is not `true`.
- Skip locked translations entirely (the human edit stays in place even though the English moved on).

This is intentional. If a locked translation falls out of sync with the English source, that's a signal a human should re-review it. To force a fresh machine translation, delete the `__locked: true` sibling and re-run the script.

## When you add a new locale

Out of scope for v2.0. Future contributors who want to add (e.g.) French should:

1. Create `src/locales/fr.json` with `{}`.
2. Add `'fr'` to the SUPPORTED list in `src/lib/locale-detect.ts`.
3. Add the resource to `src/i18n.ts`.
4. Add the locale to `LOCALE_LABELS` in `scripts/translate-i18n.mjs` (e.g. `fr: 'French (fr-FR)'`).
5. Add `'fr'` to SUPPORTED_LOCALES in `scripts/lock-translation.mjs`.
6. Add the option to `src/components/settings/LanguagePicker.tsx`.
7. Run `ANTHROPIC_API_KEY=... npm run translate-i18n -- --locale=fr`.
8. Open a PR.

A native French speaker should review the result before merge.

## Cost discipline

Every machine translation run costs real money (~$0.65 for the full 421-key catalog as of v2.0). The hash-incremental design means re-runs are nearly free unless many English strings changed. Don't run the script "to be safe" — the snapshot test (`tests/unit/i18n/en-json-snapshot.test.ts`) tells you when en.json moved.

## Out of scope

- An in-app translation contributor UI (community PRs only for v2.0).
- Languages beyond English, Spanish, German.
- RTL languages (Arabic, Hebrew). The CSS direction work hasn't been done.
