use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalWriteTarget {
    Wealthbox,
    Rightcapital,
    Holistiplan,
}

impl ExternalWriteTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wealthbox => "wealthbox",
            Self::Rightcapital => "rightcapital",
            Self::Holistiplan => "holistiplan",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalWriteKind {
    CreateRecord,
    UpdateRecord,
    UploadDocument,
    DownloadArtifact,
}

impl ExternalWriteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CreateRecord => "create_record",
            Self::UpdateRecord => "update_record",
            Self::UploadDocument => "upload_document",
            Self::DownloadArtifact => "download_artifact",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalWriteStatus {
    Proposed,
    Sending,
    Sent,
    Failed,
    VerifyPending,
    Stale,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoneyAmount {
    pub amount: f64,
    pub currency: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RightCapitalIncomeType {
    Salary,
    SelfEmployment,
    Bonus,
    ChildSupport,
    Alimony,
    Royalty,
    Pension,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncomeFrequency {
    Annual,
    Monthly,
    SemiMonthly,
    BiWeekly,
    Weekly,
    OneTime,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RightCapitalOperation {
    UpsertIncome {
        client_id: String,
        income_id: Option<String>,
        income_type: RightCapitalIncomeType,
        owner: Option<String>,
        amount: MoneyAmount,
        frequency: IncomeFrequency,
        start_date: Option<String>,
        end_date: Option<String>,
        notes: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HolistiplanOperation {
    EnsureHousehold {
        household_id: Option<String>,
        display_name: String,
    },
    EnsureClient {
        household_id: String,
        client_id: Option<String>,
        display_name: String,
    },
    UploadTaxDocument {
        document_ref: String,
        tax_year: i32,
        document_kind: String,
    },
    ImportReport {
        report_id: String,
        destination_ref: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "target", content = "payload", rename_all = "lowercase")]
pub enum ExternalWriteOperation {
    Wealthbox(serde_json::Value),
    Rightcapital(RightCapitalOperation),
    Holistiplan(HolistiplanOperation),
}

impl ExternalWriteOperation {
    pub fn target(&self) -> ExternalWriteTarget {
        match self {
            Self::Wealthbox(_) => ExternalWriteTarget::Wealthbox,
            Self::Rightcapital(_) => ExternalWriteTarget::Rightcapital,
            Self::Holistiplan(_) => ExternalWriteTarget::Holistiplan,
        }
    }

    pub fn kind(&self) -> ExternalWriteKind {
        match self {
            Self::Wealthbox(_) => ExternalWriteKind::CreateRecord,
            Self::Rightcapital(RightCapitalOperation::UpsertIncome { income_id, .. }) => {
                if income_id.as_deref().map(str::trim).unwrap_or("").is_empty() {
                    ExternalWriteKind::CreateRecord
                } else {
                    ExternalWriteKind::UpdateRecord
                }
            }
            Self::Holistiplan(HolistiplanOperation::EnsureHousehold { .. }) => {
                ExternalWriteKind::CreateRecord
            }
            Self::Holistiplan(HolistiplanOperation::EnsureClient { .. }) => {
                ExternalWriteKind::CreateRecord
            }
            Self::Holistiplan(HolistiplanOperation::UploadTaxDocument { .. }) => {
                ExternalWriteKind::UploadDocument
            }
            Self::Holistiplan(HolistiplanOperation::ImportReport { .. }) => {
                ExternalWriteKind::DownloadArtifact
            }
        }
    }

    pub fn operation_name(&self) -> &'static str {
        match self {
            Self::Wealthbox(_) => "wealthbox.unsupported",
            Self::Rightcapital(RightCapitalOperation::UpsertIncome { .. }) => {
                "rightcapital.upsert_income"
            }
            Self::Holistiplan(HolistiplanOperation::EnsureHousehold { .. }) => {
                "holistiplan.ensure_household"
            }
            Self::Holistiplan(HolistiplanOperation::EnsureClient { .. }) => {
                "holistiplan.ensure_client"
            }
            Self::Holistiplan(HolistiplanOperation::UploadTaxDocument { .. }) => {
                "holistiplan.upload_tax_document"
            }
            Self::Holistiplan(HolistiplanOperation::ImportReport { .. }) => {
                "holistiplan.import_report"
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWriteRequest {
    pub target: ExternalWriteTarget,
    pub operation: ExternalWriteOperation,
    pub matter_id: String,
    pub subject_key: String,
    pub source_ref: String,
    pub requested_at: String,
    pub before_hash: Option<String>,
    pub after_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWriteReceipt {
    pub target: String,
    pub operation: String,
    pub remote_id: String,
    pub deduped: bool,
    pub receipt_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalCurrentValue {
    pub remote_id: Option<String>,
    pub hash: String,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalRemoteResult {
    pub remote_id: String,
    pub status_code: Option<u16>,
    pub response_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalVerifyResult {
    pub applied: bool,
    pub remote_id: Option<String>,
    pub receipt_ref: Option<String>,
    pub current_hash: Option<String>,
}
