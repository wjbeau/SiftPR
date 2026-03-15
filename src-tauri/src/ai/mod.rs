pub mod client;
pub mod embeddings;
pub mod events;
pub mod json_extract;
pub mod mcp;
pub mod model_config;
pub mod orchestrator;
pub mod pipeline;
pub mod prompts;
pub mod tools;
pub mod types;

// Re-export commonly used types
pub use client::{AIClient, ModelInfo, PRAnalysis};
pub use mcp::{MCPManager, MCPTool};
pub use orchestrator::Orchestrator;
pub use types::{AgentType, OrchestratedAnalysis};
