use serde::{Deserialize, Serialize};

/// Agent types that perform specialized analysis
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    Security,
    Architecture,
    Style,
    Performance,
    Research,
}

impl AgentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentType::Security => "security",
            AgentType::Architecture => "architecture",
            AgentType::Style => "style",
            AgentType::Performance => "performance",
            AgentType::Research => "research",
        }
    }
}

/// Severity levels for findings
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

impl Severity {
    pub fn priority(&self) -> u8 {
        match self {
            Severity::Critical => 5,
            Severity::High => 4,
            Severity::Medium => 3,
            Severity::Low => 2,
            Severity::Info => 1,
        }
    }
}

/// Summary from an individual agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSummary {
    pub overview: String,
    pub risk_assessment: String,
    pub top_concerns: Vec<String>,
}

/// Individual finding from an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFinding {
    pub file: String,
    pub line: Option<u32>,
    pub message: String,
    pub severity: Severity,
    pub category: String,
    pub suggestion: Option<String>,
}

/// Token usage information
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Response from a single agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub agent_type: AgentType,
    pub summary: AgentSummary,
    pub findings: Vec<AgentFinding>,
    pub priority_files: Vec<String>,
    pub processing_time_ms: u64,
    pub token_usage: Option<TokenUsage>,
}

/// Information about a failed agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedAgent {
    pub agent_type: AgentType,
    pub error: String,
}

/// File priority for review ordering
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePriority {
    pub filename: String,
    pub priority_score: u8,
    pub reasons: Vec<String>,
}

/// Line annotation for gutter display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineAnnotation {
    pub line_number: u32,
    pub row_index: Option<u32>,
    pub annotation_type: AnnotationType,
    pub message: String,
    pub sources: Vec<AgentType>,
    pub severity: Severity,
    pub category: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationType {
    Warning,
    Info,
    Suggestion,
}

/// Context summary for a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContext {
    pub summary: String,
    pub purpose: String,
    pub related_files: Vec<String>,
}

/// Per-file analysis with annotations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAnalysis {
    pub filename: String,
    pub importance_score: u8,
    pub annotations: Vec<LineAnnotation>,
    pub context: FileContext,
    pub agent_findings: Vec<AgentFinding>,
}

/// Category for grouping changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRCategory {
    pub name: String,
    pub description: String,
    pub files: Vec<String>,
}

/// Key change highlight
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyChange {
    pub file: String,
    pub line: Option<i64>,
    pub description: String,
    pub importance: String,
}

/// A file within a functional group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupedFile {
    pub filename: String,
    pub deprioritized: bool,
    pub reason: Option<String>,
}

/// A functional area group of files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileGroup {
    pub name: String,
    pub description: String,
    pub importance: String, // "high" | "medium" | "low"
    pub files: Vec<GroupedFile>,
}

/// Aggregated analysis from all agents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratedAnalysis {
    pub summary: String,
    pub risk_level: String,
    pub file_priorities: Vec<FilePriority>,
    pub file_analyses: Vec<FileAnalysis>,
    pub categories: Vec<PRCategory>,
    pub key_changes: Vec<KeyChange>,
    pub suggested_review_order: Vec<String>,
    pub agent_responses: Vec<AgentResponse>,
    pub failed_agents: Vec<FailedAgent>,
    pub total_processing_time_ms: u64,
    pub total_token_usage: TokenUsage,
    #[serde(default)]
    pub file_groups: Vec<FileGroup>,
}

/// Raw response format expected from agents (for JSON parsing)
#[derive(Debug, Clone, Deserialize)]
pub struct RawAgentResponse {
    pub summary: RawAgentSummary,
    pub findings: Vec<RawAgentFinding>,
    pub priority_files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawAgentSummary {
    pub overview: String,
    pub risk_assessment: String,
    pub top_concerns: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawAgentFinding {
    pub file: String,
    pub line: Option<u32>,
    pub message: String,
    pub severity: String,
    pub category: String,
    pub suggestion: Option<String>,
}

impl RawAgentFinding {
    pub fn into_finding(self) -> AgentFinding {
        AgentFinding {
            file: self.file,
            line: self.line,
            message: self.message,
            severity: match self.severity.to_lowercase().as_str() {
                "critical" => Severity::Critical,
                "high" => Severity::High,
                "medium" => Severity::Medium,
                "low" => Severity::Low,
                _ => Severity::Info,
            },
            category: self.category,
            suggestion: self.suggestion,
        }
    }
}
