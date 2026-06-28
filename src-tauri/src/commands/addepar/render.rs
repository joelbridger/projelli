//! Text renderers for Addepar portfolio records.

use crate::commands::addepar::model::{
    AddeparHouseholdRecord, AddeparPortfolioNode, AddeparPortfolioQueryResponse,
};

pub fn household_source_id(entity_id: &str) -> String {
    format!("addepar:{entity_id}")
}

fn append_line(buf: &mut String, label: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    buf.push_str(label);
    buf.push_str(": ");
    buf.push_str(value);
    buf.push('\n');
}

pub fn render_household_record(record: &AddeparHouseholdRecord) -> (String, String) {
    let source_id = household_source_id(&record.entity.id);
    let mut text = String::new();
    text.push_str("Addepar household portfolio summary\n");
    append_line(&mut text, "Household", &record.entity.name());
    append_line(&mut text, "Entity ID", &record.entity.id);
    append_line(&mut text, "Model type", &record.entity.attributes.model_type);
    append_line(&mut text, "Currency", &record.entity.attributes.currency_factor);

    text.push_str("\nAsset allocation\n");
    append_query_summary(&mut text, record.asset_allocation.as_ref(), &["value", "allocation"]);

    text.push_str("\nPerformance\n");
    append_query_summary(
        &mut text,
        record.performance.as_ref(),
        &["time_weighted_return", "net_return", "value"],
    );

    text.push_str("\nAccounts and top positions\n");
    append_query_summary(&mut text, record.account_list.as_ref(), &["value", "units"]);

    if !record.warnings.is_empty() {
        text.push_str("\nSync notes\n");
        for warning in &record.warnings {
            let warning = warning.trim();
            if !warning.is_empty() {
                text.push_str("- ");
                text.push_str(warning);
                text.push('\n');
            }
        }
    }

    (source_id, text)
}

fn append_query_summary(
    text: &mut String,
    query: Option<&AddeparPortfolioQueryResponse>,
    preferred_columns: &[&str],
) {
    let Some(query) = query else {
        text.push_str("- Not available from this Addepar response.\n");
        return;
    };
    let Some(data) = &query.data else {
        text.push_str("- No portfolio rows returned.\n");
        return;
    };
    let Some(total) = &data.attributes.total else {
        text.push_str("- No portfolio total returned.\n");
        return;
    };

    append_node(text, total, 0, preferred_columns, 8);
}

fn append_node(
    text: &mut String,
    node: &AddeparPortfolioNode,
    depth: usize,
    preferred_columns: &[&str],
    remaining: usize,
) -> usize {
    if remaining == 0 {
        return 0;
    }
    let indent = "  ".repeat(depth.min(3));
    let name = if node.name.trim().is_empty() {
        "(unnamed)"
    } else {
        node.name.trim()
    };
    text.push_str(&indent);
    text.push_str("- ");
    text.push_str(name);
    let columns = format_columns(node, preferred_columns);
    if !columns.is_empty() {
        text.push_str(": ");
        text.push_str(&columns);
    }
    text.push('\n');

    let mut used = 1;
    for child in &node.children {
        if used >= remaining {
            break;
        }
        used += append_node(text, child, depth + 1, preferred_columns, remaining - used);
    }
    used
}

fn format_columns(node: &AddeparPortfolioNode, preferred_columns: &[&str]) -> String {
    let mut parts = Vec::new();
    for key in preferred_columns {
        if let Some(value) = node.columns.get(*key) {
            if let Some(formatted) = format_value(value) {
                parts.push(format!("{key} {formatted}"));
            }
        }
    }
    if parts.is_empty() {
        for (key, value) in node.columns.iter().take(3) {
            if let Some(formatted) = format_value(value) {
                parts.push(format!("{key} {formatted}"));
            }
        }
    }
    parts.join(", ")
}

fn format_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                Some(format!("{f:.4}"))
            } else {
                Some(n.to_string())
            }
        }
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::addepar::model::{
        AddeparEntityAttributes, AddeparHouseholdRecord, AddeparResource,
    };

    #[test]
    fn stable_source_id_uses_entity_id() {
        assert_eq!(household_source_id("329263"), "addepar:329263");
    }

    #[test]
    fn renders_holdings_and_performance_fixture() {
        let query_json = r#"{
          "data": {
            "type": "portfolio_views",
            "attributes": {
              "total": {
                "name": "Total",
                "columns": { "value": 439455014.1173, "time_weighted_return": 0.0239 },
                "children": [
                  { "name": "Equity", "grouping": "asset_class", "columns": { "value": 227000000, "time_weighted_return": 0.0904 }, "children": [] },
                  { "name": "Fixed Income", "grouping": "asset_class", "columns": { "value": 108000000, "time_weighted_return": 0.0005 }, "children": [] }
                ]
              }
            }
          }
        }"#;
        let query: AddeparPortfolioQueryResponse = serde_json::from_str(query_json).unwrap();
        let record = AddeparHouseholdRecord {
            entity: AddeparResource {
                id: "329263".into(),
                r#type: "entities".into(),
                attributes: AddeparEntityAttributes {
                    display_name: "Northcrest Family Household".into(),
                    model_type: "PERSON_NODE".into(),
                    ..Default::default()
                },
            },
            asset_allocation: Some(query.clone()),
            performance: Some(query),
            account_list: None,
            warnings: vec!["Account-list query unavailable".into()],
        };
        let (source_id, text) = render_household_record(&record);
        assert_eq!(source_id, "addepar:329263");
        assert!(text.contains("Northcrest Family Household"));
        assert!(text.contains("Equity"));
        assert!(text.contains("time_weighted_return"));
        assert!(text.contains("Account-list query unavailable"));
    }
}
