//! Feature-owned authority boundary for firm team activity.
//!
//! There is not yet a trusted current-member provider. Renderer authorship is
//! accepted only as explicitly staged, untrusted display data. The native
//! layer supplies the deferred role and operation labels itself.

use anyhow::{bail, Context, Result};
use chrono::DateTime;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::commands::crm::{
    commands::CrmState, core_store::CrmCoreStore, record_descriptors::valid_record_identifier,
};

pub(crate) const FIRM_ACTIVITY_SCOPE: &str = "firm_home";
pub(crate) const POST_KIND: &str = "teamActivityPost";
pub(crate) const COMMENT_KIND: &str = "teamActivityComment";
pub(crate) const REACTION_KIND: &str = "teamActivityReaction";
const STAGED_TRUST: &str = "renderer-staged-untrusted";
const MAX_BODY_CHARS: usize = 10_000;
const MAX_DISPLAY_NAME_CHARS: usize = 200;
const MAX_MENTIONS: usize = 100;
const ALLOWED_REACTIONS: &[&str] = &["👍", "❤️"];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedActivityAuthorDto {
    pub member_id: String,
    pub display_name: String,
    pub trust: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeferredActivityAuthorityDto {
    pub identity_trust: String,
    pub role_binding: String,
    pub operation_binding: String,
}

impl Default for DeferredActivityAuthorityDto {
    fn default() -> Self {
        Self {
            identity_trust: STAGED_TRUST.into(),
            role_binding: "deferred".into(),
            operation_binding: "deferred".into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivityPostDto {
    pub id: String,
    pub kind: String,
    pub matter_id: String,
    pub body: String,
    pub author: StagedActivityAuthorDto,
    pub mentioned_member_ids: Vec<String>,
    pub authority: DeferredActivityAuthorityDto,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivityCommentDto {
    pub id: String,
    pub kind: String,
    pub matter_id: String,
    pub post_id: String,
    pub body: String,
    pub author: StagedActivityAuthorDto,
    pub authority: DeferredActivityAuthorityDto,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivityReactionDto {
    pub id: String,
    pub kind: String,
    pub matter_id: String,
    pub post_id: String,
    pub emoji: String,
    pub member_id: String,
    pub authorship_trust: String,
    pub authority: DeferredActivityAuthorityDto,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum TeamActivityRecordDto {
    Post(TeamActivityPostDto),
    Comment(TeamActivityCommentDto),
    Reaction(TeamActivityReactionDto),
}

impl TeamActivityRecordDto {
    fn from_value(value: Value) -> Result<Self> {
        match value.get("kind").and_then(Value::as_str) {
            Some(POST_KIND) => Ok(Self::Post(serde_json::from_value(value)?)),
            Some(COMMENT_KIND) => Ok(Self::Comment(serde_json::from_value(value)?)),
            Some(REACTION_KIND) => Ok(Self::Reaction(serde_json::from_value(value)?)),
            _ => bail!("record is not team activity"),
        }
    }

    fn as_value(&self) -> Result<Value> {
        Ok(serde_json::to_value(self)?)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamActivityPostDto {
    pub id: String,
    pub matter_id: String,
    pub body: String,
    pub author: StagedActivityAuthorDto,
    #[serde(default)]
    pub mentioned_member_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTeamActivityCommentDto {
    pub id: String,
    pub matter_id: String,
    pub post_id: String,
    pub body: String,
    pub author: StagedActivityAuthorDto,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTeamActivityReactionDto {
    pub id: String,
    pub matter_id: String,
    pub post_id: String,
    pub emoji: String,
    pub member_id: String,
    pub authorship_trust: String,
    pub active: bool,
}

fn validate_scope(matter_id: &str) -> Result<()> {
    if matter_id != FIRM_ACTIVITY_SCOPE {
        bail!("team activity must use the canonical firm_home matter scope")
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<()> {
    if value.len() > 240 || !valid_record_identifier(value, true) {
        bail!("team activity {label} is invalid")
    }
    Ok(())
}

fn validate_prefixed_identifier(value: &str, prefix: &str, label: &str) -> Result<()> {
    validate_identifier(value, label)?;
    if !value.starts_with(prefix) {
        bail!("team activity {label} has the wrong namespace")
    }
    Ok(())
}

fn validate_body(value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("team activity body is required")
    }
    if trimmed.chars().count() > MAX_BODY_CHARS {
        bail!("team activity body is too long")
    }
    Ok(())
}

fn validate_author(author: &StagedActivityAuthorDto) -> Result<()> {
    validate_identifier(&author.member_id, "staged member id")?;
    let display_name = author.display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > MAX_DISPLAY_NAME_CHARS {
        bail!("team activity staged display name is invalid")
    }
    if author.trust != STAGED_TRUST {
        bail!("team activity authorship must remain explicitly untrusted and staged")
    }
    Ok(())
}

fn validate_authority(authority: &DeferredActivityAuthorityDto) -> Result<()> {
    if authority.identity_trust != STAGED_TRUST
        || authority.role_binding != "deferred"
        || authority.operation_binding != "deferred"
    {
        bail!("team activity native authority binding is invalid")
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<()> {
    DateTime::parse_from_rfc3339(value).context("team activity timestamp is invalid")?;
    Ok(())
}

fn validate_mentions(member_ids: &[String]) -> Result<()> {
    if member_ids.len() > MAX_MENTIONS {
        bail!("team activity has too many mentions")
    }
    let mut sorted = member_ids.to_vec();
    for member_id in &sorted {
        validate_identifier(member_id, "mentioned member id")?;
    }
    sorted.sort();
    sorted.dedup();
    if sorted.len() != member_ids.len() {
        bail!("team activity mentions contain duplicates")
    }
    Ok(())
}

fn staged_actor(record: &TeamActivityRecordDto) -> (&str, Option<&str>, &str, &str) {
    match record {
        TeamActivityRecordDto::Post(post) => {
            (&post.author.member_id, None, &post.kind, &post.created_at)
        }
        TeamActivityRecordDto::Comment(comment) => (
            &comment.author.member_id,
            Some(&comment.post_id),
            &comment.kind,
            &comment.created_at,
        ),
        TeamActivityRecordDto::Reaction(reaction) => (
            &reaction.member_id,
            Some(&reaction.post_id),
            &reaction.kind,
            &reaction.created_at,
        ),
    }
}

fn validate_typed_record(record: &TeamActivityRecordDto) -> Result<()> {
    match record {
        TeamActivityRecordDto::Post(post) => {
            validate_prefixed_identifier(&post.id, "team-activity-post:", "post id")?;
            if post.kind != POST_KIND {
                bail!("team activity post kind is invalid")
            }
            validate_scope(&post.matter_id)?;
            validate_body(&post.body)?;
            validate_author(&post.author)?;
            validate_mentions(&post.mentioned_member_ids)?;
            validate_authority(&post.authority)?;
            validate_timestamp(&post.created_at)?;
            validate_timestamp(&post.updated_at)?;
        }
        TeamActivityRecordDto::Comment(comment) => {
            validate_prefixed_identifier(&comment.id, "team-activity-comment:", "comment id")?;
            validate_prefixed_identifier(
                &comment.post_id,
                "team-activity-post:",
                "parent post id",
            )?;
            if comment.kind != COMMENT_KIND {
                bail!("team activity comment kind is invalid")
            }
            validate_scope(&comment.matter_id)?;
            validate_body(&comment.body)?;
            validate_author(&comment.author)?;
            validate_authority(&comment.authority)?;
            validate_timestamp(&comment.created_at)?;
            validate_timestamp(&comment.updated_at)?;
        }
        TeamActivityRecordDto::Reaction(reaction) => {
            validate_prefixed_identifier(&reaction.id, "team-activity-reaction:", "reaction id")?;
            validate_prefixed_identifier(
                &reaction.post_id,
                "team-activity-post:",
                "parent post id",
            )?;
            if reaction.kind != REACTION_KIND {
                bail!("team activity reaction kind is invalid")
            }
            validate_scope(&reaction.matter_id)?;
            validate_identifier(&reaction.member_id, "staged member id")?;
            if reaction.authorship_trust != STAGED_TRUST {
                bail!(
                    "team activity reaction authorship must remain explicitly untrusted and staged"
                )
            }
            if !ALLOWED_REACTIONS.contains(&reaction.emoji.as_str()) {
                bail!("team activity reaction is not allowed")
            }
            validate_authority(&reaction.authority)?;
            validate_timestamp(&reaction.created_at)?;
            validate_timestamp(&reaction.updated_at)?;
        }
    }
    Ok(())
}

/// Generic relay ingestion runs this too, so generic live-record writes cannot
/// bypass activity validation even though renderer mutations use the commands.
pub(crate) fn validate_activity_record(value: &Value) -> Result<()> {
    validate_typed_record(&TeamActivityRecordDto::from_value(value.clone())?)
}

fn require_parent_post(conn: &Connection, matter_id: &str, post_id: &str) -> Result<()> {
    let kind = conn
        .query_row(
            "SELECT kind FROM crm_team_activity_projection WHERE matter_id=?1 AND record_id=?2",
            params![matter_id, post_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if kind.as_deref() != Some(POST_KIND) {
        let exists_elsewhere: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM crm_team_activity_projection WHERE record_id=?1)",
            [post_id],
            |row| row.get(0),
        )?;
        if exists_elsewhere {
            bail!("team activity parent post belongs to a different matter scope")
        }
        bail!("team activity parent post does not exist in this matter scope")
    }
    Ok(())
}

fn validate_projection_preconditions(
    conn: &Connection,
    record: &TeamActivityRecordDto,
) -> Result<bool> {
    let (actor_id, parent_post_id, kind, _) = staged_actor(record);
    let (matter_id, record_id) = match record {
        TeamActivityRecordDto::Post(post) => (&post.matter_id, &post.id),
        TeamActivityRecordDto::Comment(comment) => (&comment.matter_id, &comment.id),
        TeamActivityRecordDto::Reaction(reaction) => (&reaction.matter_id, &reaction.id),
    };
    if let Some(parent) = parent_post_id {
        require_parent_post(conn, matter_id, parent)?;
    }

    let existing = conn
        .query_row(
            "SELECT kind,parent_post_id,staged_actor_id FROM crm_team_activity_projection
         WHERE matter_id=?1 AND record_id=?2",
            params![matter_id, record_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    if let Some((stored_kind, stored_parent, stored_actor)) = existing {
        if kind != REACTION_KIND {
            bail!("team activity posts and comments are append-only")
        }
        if stored_kind != kind
            || stored_parent.as_deref() != parent_post_id
            || stored_actor != actor_id
        {
            bail!("team activity reaction identity fields cannot change")
        }
        return Ok(true);
    }

    Ok(false)
}

/// Projects in the same transaction as the canonical CRM document. Parent
/// checks cannot race or leave an orphan behind.
pub(crate) fn project_activity_record(value: &Value, conn: &Connection) -> Result<()> {
    let record = TeamActivityRecordDto::from_value(value.clone())?;
    validate_typed_record(&record)?;
    if validate_projection_preconditions(conn, &record)? {
        return Ok(());
    }
    let (actor_id, parent_post_id, kind, created_at) = staged_actor(&record);
    let (matter_id, record_id) = match &record {
        TeamActivityRecordDto::Post(post) => (&post.matter_id, &post.id),
        TeamActivityRecordDto::Comment(comment) => (&comment.matter_id, &comment.id),
        TeamActivityRecordDto::Reaction(reaction) => (&reaction.matter_id, &reaction.id),
    };

    conn.execute(
        "INSERT INTO crm_team_activity_projection(
            matter_id,record_id,kind,parent_post_id,staged_actor_id,authorship_trust,created_at
         ) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            matter_id,
            record_id,
            kind,
            parent_post_id,
            actor_id,
            STAGED_TRUST,
            created_at
        ],
    )?;
    Ok(())
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn persist(store: &CrmCoreStore, record: TeamActivityRecordDto) -> Result<TeamActivityRecordDto> {
    validate_typed_record(&record)?;
    store.transaction(|transaction| {
        validate_projection_preconditions(transaction, &record).map(|_| ())
    })?;
    store.upsert_live_record(&record.as_value()?)?;
    Ok(record)
}

pub fn create_post(
    store: &CrmCoreStore,
    input: CreateTeamActivityPostDto,
) -> Result<TeamActivityRecordDto> {
    let timestamp = now();
    persist(
        store,
        TeamActivityRecordDto::Post(TeamActivityPostDto {
            id: input.id,
            kind: POST_KIND.into(),
            matter_id: input.matter_id,
            body: input.body.trim().into(),
            author: input.author,
            mentioned_member_ids: input.mentioned_member_ids,
            authority: DeferredActivityAuthorityDto::default(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
        }),
    )
}

pub fn add_comment(
    store: &CrmCoreStore,
    input: AddTeamActivityCommentDto,
) -> Result<TeamActivityRecordDto> {
    let timestamp = now();
    persist(
        store,
        TeamActivityRecordDto::Comment(TeamActivityCommentDto {
            id: input.id,
            kind: COMMENT_KIND.into(),
            matter_id: input.matter_id,
            post_id: input.post_id,
            body: input.body.trim().into(),
            author: input.author,
            authority: DeferredActivityAuthorityDto::default(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
        }),
    )
}

pub fn set_reaction(
    store: &CrmCoreStore,
    input: SetTeamActivityReactionDto,
) -> Result<TeamActivityRecordDto> {
    let timestamp = now();
    persist(
        store,
        TeamActivityRecordDto::Reaction(TeamActivityReactionDto {
            id: input.id,
            kind: REACTION_KIND.into(),
            matter_id: input.matter_id,
            post_id: input.post_id,
            emoji: input.emoji,
            member_id: input.member_id,
            authorship_trust: input.authorship_trust,
            authority: DeferredActivityAuthorityDto::default(),
            active: input.active,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        }),
    )
}

pub fn list_records(store: &CrmCoreStore, matter_id: &str) -> Result<Vec<TeamActivityRecordDto>> {
    validate_scope(matter_id)?;
    store.transaction(|transaction| {
        let mut statement = transaction.prepare(
            "SELECT docs.yjs_state
             FROM crm_team_activity_projection activity
             JOIN crm_docs docs ON docs.matter_id=activity.matter_id
              AND docs.doc_id=('live:' || activity.record_id)
             WHERE activity.matter_id=?1 AND docs.deleted=0
             ORDER BY activity.created_at ASC, activity.record_id ASC",
        )?;
        let rows = statement
            .query_map([matter_id], |row| row.get::<_, Vec<u8>>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|bytes| {
                let value: Value =
                    serde_json::from_slice(&bytes).context("decode stored team activity record")?;
                TeamActivityRecordDto::from_value(value)
            })
            .collect()
    })
}

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state.service().workspace().await
}

#[tauri::command]
pub async fn crm_activity_list(
    state: State<'_, CrmState>,
    matter_id: String,
) -> Result<Vec<TeamActivityRecordDto>, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || list_records(&CrmCoreStore::open(&workspace)?, &matter_id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_activity_create_post(
    state: State<'_, CrmState>,
    input: CreateTeamActivityPostDto,
) -> Result<TeamActivityRecordDto, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || create_post(&CrmCoreStore::open(&workspace)?, input))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_activity_add_comment(
    state: State<'_, CrmState>,
    input: AddTeamActivityCommentDto,
) -> Result<TeamActivityRecordDto, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || add_comment(&CrmCoreStore::open(&workspace)?, input))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn crm_activity_set_reaction(
    state: State<'_, CrmState>,
    input: SetTeamActivityReactionDto,
) -> Result<TeamActivityRecordDto, String> {
    let workspace = workspace(&state).await?;
    tokio::task::spawn_blocking(move || set_reaction(&CrmCoreStore::open(&workspace)?, input))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, CrmCoreStore) {
        let directory = tempfile::tempdir().unwrap();
        let store = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        (directory, store)
    }

    fn author(member_id: &str) -> StagedActivityAuthorDto {
        StagedActivityAuthorDto {
            member_id: member_id.into(),
            display_name: "Staged member".into(),
            trust: STAGED_TRUST.into(),
        }
    }

    fn post_input(id: &str) -> CreateTeamActivityPostDto {
        CreateTeamActivityPostDto {
            id: id.into(),
            matter_id: FIRM_ACTIVITY_SCOPE.into(),
            body: "Annual review is ready.".into(),
            author: author("member-1"),
            mentioned_member_ids: vec!["member-2".into()],
        }
    }

    #[test]
    fn valid_post_comment_reaction_reload_from_the_canonical_store() {
        let (directory, store) = store();
        create_post(&store, post_input("team-activity-post:one")).unwrap();
        add_comment(
            &store,
            AddTeamActivityCommentDto {
                id: "team-activity-comment:one".into(),
                matter_id: FIRM_ACTIVITY_SCOPE.into(),
                post_id: "team-activity-post:one".into(),
                body: "Packet sent.".into(),
                author: author("member-2"),
            },
        )
        .unwrap();
        set_reaction(
            &store,
            SetTeamActivityReactionDto {
                id: "team-activity-reaction:one".into(),
                matter_id: FIRM_ACTIVITY_SCOPE.into(),
                post_id: "team-activity-post:one".into(),
                emoji: "👍".into(),
                member_id: "member-2".into(),
                authorship_trust: STAGED_TRUST.into(),
                active: true,
            },
        )
        .unwrap();
        drop(store);
        let reopened = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
        assert_eq!(
            list_records(&reopened, FIRM_ACTIVITY_SCOPE).unwrap().len(),
            3
        );
    }

    #[test]
    fn rejects_blank_oversized_malformed_and_forged_authority_inputs() {
        let (_directory, store) = store();
        let mut blank = post_input("team-activity-post:blank");
        blank.body = "   ".into();
        assert!(create_post(&store, blank)
            .unwrap_err()
            .to_string()
            .contains("body is required"));
        let mut oversized = post_input("team-activity-post:large");
        oversized.body = "x".repeat(MAX_BODY_CHARS + 1);
        assert!(create_post(&store, oversized).is_err());
        let mut forged = post_input("team-activity-post:forged");
        forged.author.trust = "trusted".into();
        assert!(create_post(&store, forged).is_err());
        assert!(create_post(&store, post_input("not an id")).is_err());
    }

    #[test]
    fn rejects_missing_and_cross_scope_parents_without_phantom_rows() {
        let (_directory, store) = store();
        let missing = add_comment(
            &store,
            AddTeamActivityCommentDto {
                id: "team-activity-comment:missing".into(),
                matter_id: FIRM_ACTIVITY_SCOPE.into(),
                post_id: "team-activity-post:missing".into(),
                body: "No parent".into(),
                author: author("member-2"),
            },
        );
        assert!(missing.unwrap_err().to_string().contains("does not exist"));
        assert!(list_records(&store, FIRM_ACTIVITY_SCOPE)
            .unwrap()
            .is_empty());
        store.transaction(|transaction| {
            transaction.execute(
                "INSERT INTO crm_team_activity_projection(matter_id,record_id,kind,parent_post_id,staged_actor_id,authorship_trust,created_at) VALUES(?1,?2,?3,NULL,?4,?5,?6)",
                params!["another-firm", "team-activity-post:other", POST_KIND, "member-1", STAGED_TRUST, now()],
            )?;
            Ok(())
        }).unwrap();
        let cross_scope = add_comment(
            &store,
            AddTeamActivityCommentDto {
                id: "team-activity-comment:cross".into(),
                matter_id: FIRM_ACTIVITY_SCOPE.into(),
                post_id: "team-activity-post:other".into(),
                body: "Wrong scope".into(),
                author: author("member-2"),
            },
        );
        assert!(cross_scope
            .unwrap_err()
            .to_string()
            .contains("different matter scope"));
    }

    #[test]
    fn parameterized_values_do_not_execute_sql_and_scopes_cannot_be_spoofed() {
        let (_directory, store) = store();
        let mut injection = post_input("team-activity-post:sql");
        injection.body = "'); DROP TABLE crm_docs; --".into();
        create_post(&store, injection).unwrap();
        assert_eq!(list_records(&store, FIRM_ACTIVITY_SCOPE).unwrap().len(), 1);
        let mut wrong_scope = post_input("team-activity-post:wrong-scope");
        wrong_scope.matter_id = "another-firm".into();
        assert!(create_post(&store, wrong_scope).is_err());
    }

    #[test]
    fn failed_projection_rolls_back_the_canonical_document() {
        let (_directory, store) = store();
        create_post(&store, post_input("team-activity-post:immutable")).unwrap();
        let error = create_post(&store, post_input("team-activity-post:immutable")).unwrap_err();
        assert!(error.to_string().contains("append-only"));
        assert_eq!(list_records(&store, FIRM_ACTIVITY_SCOPE).unwrap().len(), 1);
    }
}
