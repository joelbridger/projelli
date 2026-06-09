//! The spike corpus: two matters, each with two short documents and two short
//! emails. Hand-written so the proof is deterministic and has no hidden file
//! dependency. Includes a deliberately CONFUSABLE pair (`doc:acme-spa` and
//! `doc:globex-lease`) that both describe a "closing date" in near-identical
//! legal phrasing — only the matter, the date, and the deal type differ. That
//! pair is what makes matter isolation a real test rather than a tautology.

/// One source in the corpus, before chunking. A "source" is a single document
/// or a single email message; in the real app it maps to a file path or a
/// `mail:<id>` key.
pub struct Source {
    /// Tenant/confidentiality boundary. The whole gate hinges on this.
    pub matter_id: &'static str,
    /// Stable id of the originating document or email. In the app this is the
    /// file path (documents) or `mail:<message-id>` (email).
    pub source_id: &'static str,
    /// "document" | "email" — mirrors the app's `source_type` discriminator
    /// ("text"/"pdf"/"mail"); we use the two relevant to this gate.
    pub source_type: &'static str,
    /// 1-based page for documents (paginated sources), `None` for email.
    pub page_number: Option<u32>,
    /// Verbatim source text (will be paragraph-chunked at index time).
    pub text: &'static str,
}

pub const MATTER_ACME: &str = "matter-acme";
pub const MATTER_GLOBEX: &str = "matter-globex";

/// The full corpus. Eight sources: 2 docs + 2 emails per matter.
pub fn corpus() -> Vec<Source> {
    vec![
        // ---------------------------------------------------------------
        // matter-acme — Acme Corp / TechBuyer acquisition
        // ---------------------------------------------------------------
        Source {
            matter_id: MATTER_ACME,
            source_id: "doc:acme-spa",
            source_type: "document",
            page_number: Some(7),
            // CONFUSABLE A: near-identical "closing date" phrasing to globex-lease.
            text: "ARTICLE 2. CLOSING.\n\n\
                2.1 Closing Date. The closing date of the transactions contemplated by \
                this Share Purchase Agreement shall be March 14, 2026, or such other date \
                as the parties may mutually agree in writing. The closing shall take place \
                remotely by electronic exchange of signature pages.\n\n\
                2.2 Purchase Price. The aggregate purchase price for the Shares shall be \
                Four Million Two Hundred Thousand Dollars ($4,200,000), payable by wire \
                transfer of immediately available funds at the closing.",
        },
        Source {
            matter_id: MATTER_ACME,
            source_id: "doc:acme-diligence",
            source_type: "document",
            page_number: Some(2),
            text: "DUE DILIGENCE MEMORANDUM — Project Falcon (Acme Corp).\n\n\
                The indemnification cap is limited to fifteen percent (15%) of the \
                purchase price, with a separate escrow holdback of $630,000 held for \
                eighteen months to satisfy any indemnity claims.\n\n\
                Key-employee retention: the three named founders are subject to \
                twenty-four month non-compete covenants and earn-out milestones tied to \
                ARR targets for fiscal year 2027.",
        },
        Source {
            matter_id: MATTER_ACME,
            source_id: "mail:acme-0001",
            source_type: "email",
            page_number: None,
            // CONFUSABLE A (email side): mentions "closing" + a March date.
            text: "From: cfo@acmecorp.example\n\
                To: counsel@firm.example\n\
                Subject: Wire instructions for the March 14 closing\n\n\
                Hi — confirming the wire instructions for closing. Please send the \
                $4.2M to our escrow account at First National (routing 021000021, \
                account ending 4477) no later than the morning of March 14 so funds \
                settle before we sign. Let me know if you need a voided check.",
        },
        Source {
            matter_id: MATTER_ACME,
            source_id: "mail:acme-0002",
            source_type: "email",
            page_number: None,
            text: "From: counsel@firm.example\n\
                To: board@acmecorp.example\n\
                Subject: Signing call Thursday + board approval\n\n\
                The signing call is set for Thursday at 10am Eastern. We need the \
                unanimous written consent of the board approving the transaction \
                executed and returned before the call. I have attached the consent; \
                please DocuSign in the order listed.",
        },
        // ---------------------------------------------------------------
        // matter-globex — Globex Industries lease dispute
        // ---------------------------------------------------------------
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "doc:globex-lease",
            source_type: "document",
            page_number: Some(4),
            // CONFUSABLE B: near-identical "closing date" phrasing to acme-spa,
            // but a DIFFERENT matter, date, and deal type (sublease assignment).
            text: "ARTICLE 9. ASSIGNMENT AND SUBLEASE.\n\n\
                9.3 Closing Date. The closing date of the sublease assignment \
                contemplated by this Commercial Lease shall be September 2, 2026, or \
                such other date as the parties may mutually agree in writing. \
                Possession of the demised premises shall transfer at the closing.\n\n\
                9.4 Security Deposit. The assignee shall deposit two months' rent \
                ($48,000) with the landlord at the closing as security for performance.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "doc:globex-demand",
            source_type: "document",
            page_number: Some(1),
            text: "DEMAND LETTER — Globex Industries v. Landlord.\n\n\
                Our client Globex Industries demands cure of the landlord's material \
                breach of the lease, specifically the failure to maintain the HVAC and \
                the systematic overcharging of common area maintenance (CAM) costs \
                totaling $112,400 over three years.\n\n\
                Unless the breach is cured within the thirty (30) day cure period \
                provided by Section 14.2, Globex will pursue all remedies including \
                rescission and damages.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "mail:globex-0001",
            source_type: "email",
            page_number: None,
            // CONFUSABLE B (email side): mentions "closing" + a September date.
            text: "From: gc@globex.example\n\
                To: counsel@firm.example\n\
                Subject: September closing logistics and keys\n\n\
                For the sublease closing in September, can your office coordinate the \
                keys handover and the final walkthrough? The assignee wants possession \
                the same day. I will have the $48,000 security deposit ready to wire at \
                closing.",
        },
        Source {
            matter_id: MATTER_GLOBEX,
            source_id: "mail:globex-0002",
            source_type: "email",
            page_number: None,
            text: "From: counsel@firm.example\n\
                To: gc@globex.example\n\
                Subject: Rent abatement and mediation date\n\n\
                The landlord countered on the rent abatement: they will credit two \
                months but not the full CAM overcharge. I recommend we hold firm and \
                proceed to the mediation scheduled for August 19 with the retained \
                neutral. Please confirm Globex is available that date.",
        },
    ]
}
