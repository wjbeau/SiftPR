pub mod client;
pub mod embeddings;
pub mod mcp;
pub mod orchestrator;
pub mod prompts;
pub mod tools;
pub mod types;

// Re-export commonly used types
pub use client::{AIClient, ModelInfo, PRAnalysis, PRCategory, KeyChange};
pub use mcp::{MCPManager, MCPTool};
pub use orchestrator::{AgentConfig, Orchestrator, ToolConfig};
pub use tools::{ToolContext, ToolDefinition, ToolExecutionConfig, ToolExecutor};
pub use types::{
    AgentFinding, AgentResponse, AgentSummary, AgentType, AnnotationType, FailedAgent,
    FileAnalysis, FileContext, FilePriority, LineAnnotation, OrchestratedAnalysis, Severity,
    TokenUsage,
};
