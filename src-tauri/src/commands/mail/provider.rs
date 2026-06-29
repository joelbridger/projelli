use crate::commands::mail::model::MailMessage;
use async_trait::async_trait;

/// A provider folder/label (Outlook folder, Gmail label, IMAP mailbox).
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteFolder {
    pub id: String,
    pub display_name: String,
}

/// Where a folder's sync resumes from. Opaque per provider (Graph delta link,
/// Gmail historyId, or "UIDVALIDITY:lastUID").
#[derive(Debug, Clone, PartialEq)]
pub enum Cursor {
    Backfill,
    Resume(String),
}
impl Cursor {
    pub fn from_token(t: Option<String>) -> Cursor {
        match t {
            Some(s) => Cursor::Resume(s),
            None => Cursor::Backfill,
        }
    }
    /// The token to persist for resuming, if any.
    pub fn token(&self) -> Option<&str> {
        match self {
            Cursor::Resume(s) => Some(s.as_str()),
            Cursor::Backfill => None,
        }
    }
}

/// One page of changes for a folder.
pub struct ChangePage {
    pub messages: Vec<MailMessage>, // already normalized
    pub removed_ids: Vec<String>,   // tombstones
    /// Resume token for the next call; None means this folder round is complete.
    pub next: Option<String>,
    /// True when the round completed (the `next` token, if any, is a deltaLink/historyId to save).
    pub done: bool,
}

/// A source of email for one account. Implemented per provider (M365, Gmail, IMAP).
#[async_trait]
pub trait MailProvider: Send + Sync {
    /// Stable provider id: "m365" | "gmail" | "imap".
    fn kind(&self) -> &'static str;
    /// List the account's folders/labels/mailboxes.
    async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>>;
    /// Fetch one page of changes for `folder` starting from `cursor`.
    async fn fetch_changes(
        &self,
        folder: &RemoteFolder,
        cursor: &Cursor,
    ) -> anyhow::Result<ChangePage>;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_from_token_maps_some_and_none() {
        assert_eq!(
            Cursor::from_token(Some("abc".into())),
            Cursor::Resume("abc".into())
        );
        assert_eq!(Cursor::from_token(None), Cursor::Backfill);
    }
}
