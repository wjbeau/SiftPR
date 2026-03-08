pub mod client;
pub mod orchestrator;
pub mod prompts;
pub mod types;

// Re-export commonly used types
pub use client::{AIClient, ModelInfo, PRAnalysis, PRCategory, KeyChange};
pub use orchestrator::Orchestrator;
pub use types::{
    AgentFinding, AgentResponse, AgentSummary, AgentType, AnnotationType, FailedAgent,
    FileAnalysis, FileContext, FilePriority, LineAnnotation, OrchestratedAnalysis, Severity,
    TokenUsage,
};
