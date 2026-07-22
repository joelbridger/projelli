# Feature-map renderer contract

`feature-map.html` only renders data that passes its four-label contract and its payload check. The labels are exactly:

- Planned → `planned`
- Being built → `being-built`
- Built — checking it → `built-checking`
- Proven on Windows → `proven-windows`

Before it draws a card, starts pan/zoom, fetches comments, or enables map actions, the page fetches `feature-map-data.json` as raw text. Until that succeeds, every map button is disabled and has no action listener: clicks cannot change the URL, selected layer/style/filter, page state, map, pan/zoom, or comments. Its built-in strict reader rejects duplicate object keys at every level, malformed JSON, unsafe numbers (only safe integers are allowed), unpaired Unicode surrogates, and values outside JSON. It then requires the exact top-level field list, including `payload_sha256`.

The page builds the unsigned payload form directly as text: object names are sorted by Unicode scalar value, array order is kept, separators are compact, text is UTF-8 with normal Unicode characters, and only the top-level `payload_sha256` is left out. Browser WebCrypto calculates SHA-256 over those bytes. Only a matching lower-case 64-character digest proceeds to the existing four-label and requirement checks. Any network, parsing, contract, digest, or WebCrypto failure leaves zero journey cards, zero foundation cards, and zero outside-V1 cards, with one plain visible error. It does not guess a label or render first and erase later.

This is the trust sequence:

1. Receive raw payload text.
2. Strictly parse it and refuse ambiguous or unsafe JSON.
3. Check the exact payload shape and digest spelling.
4. Canonicalize it and verify its SHA-256 with WebCrypto.
5. Run the renderer's four-label and row-count checks.
6. Draw the map, then load comments and turn on interactions.

`input_hash` must be a 64-character SHA-256 hexadecimal value; its first 12 characters are shown with `...`, while the exact value is retained in `#updated[data-input-hash]`.

`requirementUniverse` is required control data, but its requirement rows are not feature cards. It has exactly 238 V1 rows: 151 Wealthbox, 63 Jump, and 24 shared-control rows. Its separate `outside_v1` list has exactly 21 rows and never changes the V1 total. The renderer checks the exact row fields, allowed scopes, public labels, unique identifiers, source split, and feature-to-requirement references before rendering. The stable `#updated` marker retains these accepted counts in data attributes for the DOM contract.

Today shows those exact labels. Future vision is deliberately marked as a future picture, not current proof. Not in V1 stays in a separate small panel and never changes V1 counts or filters. A Not in V1 item uses the general scope wording unless control data supplies a non-blank `outsideV1Reason`; it never repurposes `statusNote` as a scope decision.

The marker `feature-map-renderer-version=four-label-v1` lets a publisher reject an older renderer. It remains in the one-document shape the reviewed publisher accepts: one `<!DOCTYPE html>`, only HTML whitespace before the exact `<html lang="en">` opener, the one exact ordered marker meta tag in `<head>`, and no bytes outside the document other than its single final newline. There is no locally invented fingerprint: the renderer consumes only supplied control-generated data.

The digest detects a changed payload, including a changed nested value or array order. It is not the final authority against an attacker replacing both the payload and its digest together. The protected publisher and its served-byte browser receipt remain the authority for that stronger replacement case.

Run the renderer contract checks without network access:

```bash
node docs/board/feature-map-renderer.test.mjs
```

The offline test reads shared proof material from one optional coordination-root
environment variable, LANTERN_COORDINATION_ROOT. It defaults to
/home/jameson/lantern/coordination and derives the accepted data, shared
vectors, JavaScript reference, and publisher from that root. It stops with a
clear missing-file error if that checkout is incomplete; it never depends on a
temporary worktree.
