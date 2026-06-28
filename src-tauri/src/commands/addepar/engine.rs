//! Addepar household sync engine.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;

use crate::commands::addepar::client::AddeparClient;
use crate::commands::addepar::model::{
    AddeparEntity, AddeparHouseholdRecord, AddeparMatterMapEntry, AddeparNeedsAssignment,
};
use crate::commands::addepar::render::render_household_record;

#[async_trait]
pub trait AddeparSource: Send + Sync {
    async fn list_entities(&self) -> anyhow::Result<Vec<AddeparEntity>>;
    async fn household_record(&self, entity: &AddeparEntity) -> anyhow::Result<AddeparHouseholdRecord>;
}

#[async_trait]
impl AddeparSource for AddeparClient {
    async fn list_entities(&self) -> anyhow::Result<Vec<AddeparEntity>> {
        AddeparClient::list_entities(self).await
    }

    async fn household_record(&self, entity: &AddeparEntity) -> anyhow::Result<AddeparHouseholdRecord> {
        AddeparClient::household_record(self, entity).await
    }
}

#[derive(Debug, Clone)]
pub struct AddeparIndexItem {
    pub source_id: String,
    pub text: String,
    pub matter_id: String,
}

#[derive(Debug, Default, Clone)]
pub struct AddeparSyncReport {
    pub entities_fetched: u32,
    pub households_processed: u32,
    pub records_indexed: u32,
    pub needs_assignment: Vec<AddeparNeedsAssignment>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub matter_id: String,
    pub needs_assignment: bool,
    pub reason: String,
}

pub fn resolve_entity_matter(
    entity: &AddeparEntity,
    matter_map: &[AddeparMatterMapEntry],
) -> Assignment {
    let key_map = build_key_map(matter_map);
    let mut matches = HashSet::new();
    collect_exact(&key_map, &mut matches, &entity.id);
    if matches.is_empty() {
        collect_exact(&key_map, &mut matches, &entity.name());
    }

    if matches.len() == 1 {
        return Assignment {
            matter_id: matches.into_iter().next().unwrap(),
            needs_assignment: false,
            reason: String::new(),
        };
    }
    Assignment {
        matter_id: crate::commands::rag::store::UNASSIGNED_MATTER.to_string(),
        needs_assignment: true,
        reason: if matches.is_empty() {
            "no client matched this Addepar household"
        } else {
            "multiple clients matched this Addepar household"
        }
        .to_string(),
    }
}

fn build_key_map(matter_map: &[AddeparMatterMapEntry]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for entry in matter_map {
        let key = normalize_key(&entry.addepar_key);
        if key.is_empty() || entry.matter_id.trim().is_empty() {
            continue;
        }
        map.entry(key).or_default().push(entry.matter_id.clone());
    }
    map
}

fn collect_exact(
    key_map: &HashMap<String, Vec<String>>,
    matches: &mut HashSet<String>,
    candidate: &str,
) {
    let key = normalize_key(candidate);
    if let Some(matter_ids) = key_map.get(&key) {
        matches.extend(matter_ids.iter().cloned());
    }
}

fn normalize_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(['<', '>', '"', '\'', ',', ';'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

type IndexOneFuture<'a> = Pin<Box<dyn Future<Output = anyhow::Result<u32>> + Send + 'a>>;

async fn apply_index_items<F>(items: &[AddeparIndexItem], mut index_one: F) -> anyhow::Result<u32>
where
    F: for<'a> FnMut(&'a AddeparIndexItem) -> IndexOneFuture<'a> + Send,
{
    let mut count = 0;
    for item in items {
        count += index_one(item).await?;
    }
    Ok(count)
}

pub async fn apply_index_with_key(
    workspace: &Path,
    items: &[AddeparIndexItem],
    key: &[u8; 32],
) -> anyhow::Result<u32> {
    let workspace = workspace.to_path_buf();
    let key = *key;
    apply_index_items(items, move |item| {
        let workspace = workspace.clone();
        Box::pin(async move {
            crate::commands::connector::index_external_text_with_key_internal(
                &workspace,
                &item.source_id,
                &item.text,
                &item.matter_id,
                "addepar",
                &key,
            )
            .await
        })
    })
    .await
}

pub async fn sync_with_key(
    source: &dyn AddeparSource,
    workspace: &Path,
    matter_map: &[AddeparMatterMapEntry],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
) -> anyhow::Result<AddeparSyncReport> {
    let entities = source.list_entities().await?;
    let mut report = AddeparSyncReport {
        entities_fetched: entities.len() as u32,
        ..Default::default()
    };
    let mut items = Vec::new();

    for entity in entities {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        let assignment = resolve_entity_matter(&entity, matter_map);
        if assignment.needs_assignment {
            report.needs_assignment.push(AddeparNeedsAssignment {
                source_id: crate::commands::addepar::render::household_source_id(&entity.id),
                entity_id: entity.id.clone(),
                name: entity.name(),
                reason: assignment.reason,
            });
            continue;
        }

        let record = source.household_record(&entity).await?;
        let (source_id, text) = render_household_record(&record);
        items.push(AddeparIndexItem {
            source_id,
            text,
            matter_id: assignment.matter_id,
        });
        report.households_processed += 1;
    }

    if report.cancelled {
        return Ok(report);
    }
    report.records_indexed = apply_index_with_key(workspace, &items, rag_key).await?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::addepar::model::{
        AddeparEntityAttributes, AddeparPortfolioQueryResponse, AddeparResource,
    };

    fn entity(id: &str, name: &str) -> AddeparEntity {
        AddeparResource {
            id: id.into(),
            r#type: "entities".into(),
            attributes: AddeparEntityAttributes {
                display_name: name.into(),
                model_type: "PERSON_NODE".into(),
                ..Default::default()
            },
        }
    }

    #[test]
    fn household_matching_prefers_addepar_entity_id() {
        let assignment = resolve_entity_matter(
            &entity("329263", "Northcrest Family Household"),
            &[AddeparMatterMapEntry {
                addepar_key: "329263".into(),
                matter_id: "matter-northcrest".into(),
            }],
        );
        assert_eq!(assignment.matter_id, "matter-northcrest");
        assert!(!assignment.needs_assignment);
    }

    #[test]
    fn household_matching_can_use_household_name() {
        let assignment = resolve_entity_matter(
            &entity("329263", "Northcrest Family Household"),
            &[AddeparMatterMapEntry {
                addepar_key: " northcrest   family household ".into(),
                matter_id: "matter-northcrest".into(),
            }],
        );
        assert_eq!(assignment.matter_id, "matter-northcrest");
        assert!(!assignment.needs_assignment);
    }

    #[test]
    fn unmatched_household_needs_assignment() {
        let assignment = resolve_entity_matter(&entity("329263", "Northcrest"), &[]);
        assert_eq!(assignment.matter_id, crate::commands::rag::store::UNASSIGNED_MATTER);
        assert!(assignment.needs_assignment);
    }

    #[test]
    fn indexed_item_uses_stable_source_id() {
        let record = AddeparHouseholdRecord {
            entity: entity("329263", "Northcrest"),
            asset_allocation: Some(AddeparPortfolioQueryResponse::default()),
            performance: None,
            account_list: None,
            warnings: vec![],
        };
        let (source_id, text) = crate::commands::addepar::render::render_household_record(&record);
        assert_eq!(source_id, "addepar:329263");
        assert!(text.contains("Addepar household portfolio summary"));
    }
}
