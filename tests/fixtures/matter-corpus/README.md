# Matter Corpus — Campaign Fixture Files

Fixture corpus for the Keepance 3.0 quality campaign. Used by:
- Playwright campaign specs (`tests/campaign/`)
- Rust fixture validation tests (`src-tauri/crates/keepance-docx/tests/campaign_fixtures.rs`)

## Regenerating fixtures

```bash
python3 tests/fixtures/matter-corpus/generators/generate-fixtures.py
```

Requires: `python-docx`, `openpyxl`, `python-pptx`

```bash
pip3 install python-docx openpyxl python-pptx
```

## Matter A — Johnson v. Nexus Dynamics Corp.

Employment dispute / wrongful termination. Primary test matter for all litigation
workflow features.

| File | Description |
|------|-------------|
| `engagement-letter-tracked.docx` | 2-page engagement letter with **4 tracked changes** (2 `w:ins` by Diane Marchetti, 2 `w:del` by James Thornton) and **2 comments**. Tests the tracked-changes viewer, OOXML round-trip, and redline engine. |
| `deposition-transcript-johnson.txt` | 200+ line Q/A deposition transcript for Marcus Johnson. Employment-dispute theme. Contains **3 planted contradictions** against `incident-summary-johnson.md` — see below. |
| `incident-summary-johnson.md` | Matter summary contradicting the deposition in 3 places. Used by the Deposition Contradiction Finder workflow. |
| `contract-services-agreement.docx` | Simple valid docx, 5 clauses. General contract review fixture. |
| `scanned-exhibit.pdf` | Minimal valid 1-page PDF (hand-built bytes). Exhibit A placeholder. Tests PDF viewer. |
| `damages-model.xlsx` | Damages calculation spreadsheet. Tests spreadsheet viewer. |
| `exhibit-deck.pptx` | 2-slide presentation. Tests presentation viewer. |
| `huge-notes.md` | ~2MB of generated legal-flavored markdown. Tests large-file handling. |
| `empty.docx` | Zero-byte file (deliberately invalid). Tests graceful error handling. |
| `Müller — Schäfer engagement (draft 2).docx` | Valid minimal docx exercising unicode characters, spaces, and parentheses in the filename. Tests file-tree handling of unusual names. |

### Planted Contradictions (deposition vs. summary)

The deposition transcript and incident summary contain three deliberate factual
discrepancies. These are the targets for the Deposition Contradiction Finder
workflow.

| ID | Transcript says | Summary says |
|----|----------------|--------------|
| CONTRADICTION-1 | Johnson forwarded documents to his personal email for safekeeping (Sept 9-10, 2025) | No documents left company systems; all materials remained on company servers only |
| CONTRADICTION-2 | Compliance written-response deadline was **October 17, 2025** | Deadline given was **October 10, 2025** |
| CONTRADICTION-3 | Severance offer was **four weeks** | Severance offer was **eight weeks** (per policy for employees with 5+ years of service) |

## Matter B — Acme Corporation v. Road Runner Logistics LLC

Contract breach / supply chain disruption. Entirely separate matter — used for
cross-matter isolation tests.

| File | Description |
|------|-------------|
| `matter-b-acme/intake-memo-acme.docx` | Client intake memo for Acme Corp. — Wile E. Coyote, CEO. Breach of contract claim. |
| `matter-b-acme/acme-supply-agreement.txt` | Plain-text supply agreement (24 months, Widget Model X). |
| `matter-b-acme/acme-damages-summary.xlsx` | Shipment delay log with liquidated damages calculation. |

Content distinctness: these files contain "Acme" / "Road Runner" / "Coyote" and
do NOT contain "Johnson," "Marchetti," or "Nexus Dynamics" — enforced by the
Rust isolation test.

## IMAP Fixture Server

A local Greenmail IMAP server is used for email intelligence tests.

- **Container:** `keepance-campaign-imap`
- **IMAP host:** `127.0.0.1:3143`
- **SMTP host:** `127.0.0.1:3025`
- **Test mailbox:** `diane@marchetti-law.test` / password `test`
- **Seeded with:** 12 emails on the Johnson matter (see `generators/seed-imap.mjs`)

Start the server:

```bash
docker run -d --name keepance-campaign-imap \
  -p 127.0.0.1:3143:3143 \
  -p 127.0.0.1:3025:3025 \
  -m 512m \
  greenmail/standalone:latest

node tests/fixtures/matter-corpus/generators/seed-imap.mjs
```

## Rust validation

The fixture validation suite is at:
`src-tauri/crates/keepance-docx/tests/campaign_fixtures.rs`

Run:
```bash
cd src-tauri && cargo test -p keepance-docx --test campaign_fixtures
```
