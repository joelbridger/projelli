# Spike corpus — two matters, mixed documents + emails

A deliberately small, hand-written corpus that makes matter isolation *meaningful*.
The chunk text used by the tests lives in `src/corpus.rs` (so the proof has no
hidden file I/O dependency and runs fully deterministically). These `.md` / `.eml`
files are the human-readable mirror of that data, kept for inspection.

## Matters

- **matter-acme** — *Acme Corp / TechBuyer acquisition* (Client: Acme Corp)
- **matter-globex** — *Globex Industries lease dispute* (Client: Globex Industries)

## Sources per matter

| matter | source_id | source_type | one-line content |
|---|---|---|---|
| matter-acme | doc:acme-spa | document | Acme share purchase agreement: **closing date** is March 14, 2026; purchase price $4.2M |
| matter-acme | doc:acme-diligence | document | Acme diligence memo: indemnity cap, escrow holdback, key-employee retention |
| matter-acme | mail:acme-0001 | email | Email from Acme CFO re wire instructions for the March 14 **closing** |
| matter-acme | mail:acme-0002 | email | Email scheduling the signing call; mentions board approval |
| matter-globex | doc:globex-lease | document | Globex commercial lease: **closing date** for the sublease assignment is September 2, 2026 |
| matter-globex | doc:globex-demand | document | Globex demand letter: landlord breach, CAM overcharges, cure period |
| matter-globex | mail:globex-0001 | email | Email from Globex GC re the September **closing** logistics and keys handover |
| matter-globex | mail:globex-0002 | email | Email about the rent abatement negotiation and mediation date |

## The confusable pair (why isolation is non-trivial)

`doc:acme-spa` and `doc:globex-lease` BOTH talk about a "closing date" in nearly
identical legal phrasing, only the matter, the actual date, and the deal type
differ. A pure-similarity query for *"what is the closing date"* will rank BOTH
highly. The whole point of the gate is that a query **scoped to matter-acme**
must return Acme's March 14 closing and **never** surface Globex's September
closing — enforced by a store-level filter, not by UI hiding or by hoping
similarity sorts them apart.
