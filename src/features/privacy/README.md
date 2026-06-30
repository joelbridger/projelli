# Privacy Feature

The user-facing trust and transparency surface: the always-visible data-egress indicator, the printable Data Map, and the per-client/firm consent flows that make the privacy story honest and inspectable.

**Status:** Shipped.

**Key components:**
- `PrivacyCenterHome.tsx` — the main Privacy Center UI (data egress indicator, Data Map download, consent management)
- `FirmSecurityPack.tsx` — firm-tier security posture display (encryption, relay, information barriers)

Egress-indicator logic and consent state live in `src/platform/privacy/`.
