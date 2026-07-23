//! Test-only seam behind the durable Microsoft draft-save authority.
//!
//! This is deliberately not a client. It owns no credentials, performs no
//! identity lookup, and has no implementation outside local tests.

#[cfg(test)]
use anyhow::Result;

#[cfg(test)]
use super::m4_microsoft_adapter::SealedMicrosoftDraftCapability;

/// The sole outcome vocabulary for the sealed test seam. It describes saving
/// a provider draft only; it cannot express delivery.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum SealedDraftSaveOutcome {
    Saved {
        provider_draft_id: String,
        safe_metadata: String,
    },
    RefusedBeforeProvider,
    UnknownAfterProviderBoundary,
}

/// A test-only injection point. The opaque capability may be carried and
/// counted, but cannot be constructed or inspected by the implementation.
#[cfg(test)]
pub(super) trait TestOnlySealedMicrosoftDraftTransport {
    fn save(&self, capability: &SealedMicrosoftDraftCapability) -> Result<SealedDraftSaveOutcome>;
}
