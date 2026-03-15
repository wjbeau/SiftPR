//! Tool system for AI agents
//!
//! This module provides the infrastructure for agents to call tools during analysis.
//! Tools can be built-in (search_repo, read_file, web_search) or provided by MCP servers.

pub mod builtin;
pub mod executor;
pub mod formatter;

use serde::{Deserialize, Serialize};

/// Source of a tool definition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ToolSource {
    Builtin,
    MCP { server_name: String },
}

/// Definition of a tool that can be called by an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    /// JSON Schema for the tool's parameters
    pub parameters: serde_json::Value,
    pub source: ToolSource,
}

/// A tool call requested by the AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// Unique ID for this call (used to match results)
    pub id: String,
    /// Name of the tool to call
    pub name: String,
    /// Arguments as JSON
    pub arguments: serde_json::Value,
}

/// Result of executing a tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// The ID of the tool call this result is for
    pub call_id: String,
    /// The name of the tool that was called
    #[serde(default)]
    pub tool_name: String,
    /// Whether the tool executed successfully
    pub success: bool,
    /// The output from the tool (may be JSON or plain text)
    pub output: String,
    /// Error message if success is false
    pub error: Option<String>,
}

impl ToolResult {
    pub fn success(call_id: String, output: String) -> Self {
        Self {
            call_id,
            tool_name: String::new(),
            success: true,
            output,
            error: None,
        }
    }

    pub fn error(call_id: String, error: String) -> Self {
        Self {
            call_id,
            tool_name: String::new(),
            success: false,
            output: String::new(),
            error: Some(error),
        }
    }
}

/// Configuration for tool execution limits
#[derive(Debug, Clone)]
pub struct ToolExecutionConfig {
    /// Maximum number of AI request/tool-response cycles
    pub max_iterations: u32,
    /// Absolute cap on total tool invocations
    pub max_total_tool_calls: u32,
    /// Timeout for individual tool executions (milliseconds)
    pub timeout_per_tool_ms: u64,
    /// Overall timeout for the entire execution (milliseconds)
    pub total_timeout_ms: u64,
}

impl Default for ToolExecutionConfig {
    fn default() -> Self {
        Self {
            max_iterations: 10,
            max_total_tool_calls: 50,
            timeout_per_tool_ms: 30_000,
            total_timeout_ms: 300_000, // 5 minutes
        }
    }
}

/// Message types for the conversation with tools
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role")]
pub enum Message {
    #[serde(rename = "system")]
    System { content: String },
    #[serde(rename = "user")]
    User { content: String },
    #[serde(rename = "assistant")]
    Assistant { content: serde_json::Value },
    #[serde(rename = "tool")]
    ToolResults { results: Vec<ToolResult> },
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self::System {
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::User {
            content: content.into(),
        }
    }

    pub fn assistant(content: serde_json::Value) -> Self {
        Self::Assistant { content }
    }

    pub fn tool_results(results: Vec<ToolResult>) -> Self {
        Self::ToolResults { results }
    }
}

/// Context provided to tools for execution
#[derive(Debug, Clone)]
pub struct ToolContext {
    /// Path to the local repository (if linked)
    pub repo_path: Option<String>,
    /// Full name of the repository (e.g., "owner/repo") for semantic search
    pub repo_full_name: Option<String>,
    /// User ID for accessing stored credentials
    pub user_id: String,
}

// Re-export commonly used types
pub use builtin::BuiltinTool;
pub use executor::ToolExecutor;
pub use formatter::ToolFormatter;
