//! Built-in tools for AI agents
//!
//! These tools are available to all agents without requiring external configuration.

pub mod read_file;
pub mod research;
pub mod search_repo;
pub mod semantic_search;
pub mod web_search;

use async_trait::async_trait;

use super::{ToolContext, ToolDefinition, ToolResult};
use crate::error::AppResult;

/// Trait for built-in tools
#[async_trait]
pub trait BuiltinTool: Send + Sync {
    /// Get the tool definition
    fn definition(&self) -> ToolDefinition;

    /// Execute the tool with the given arguments
    async fn execute(
        &self,
        arguments: serde_json::Value,
        context: &ToolContext,
    ) -> AppResult<ToolResult>;

    /// Check if the tool is available in the given context
    fn is_available(&self, context: &ToolContext) -> bool;
}

/// Registry of all built-in tools
pub struct BuiltinToolRegistry {
    tools: Vec<Box<dyn BuiltinTool>>,
}

impl BuiltinToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: vec![
                Box::new(search_repo::SearchRepoTool::new()),
                Box::new(read_file::ReadFileTool::new()),
                Box::new(web_search::WebSearchTool::new()),
                Box::new(research::ResearchAgentTool::new()),
                Box::new(semantic_search::SemanticSearchTool::new()),
            ],
        }
    }

    /// Get all tool definitions that are available in the given context
    pub fn get_available_tools(&self, context: &ToolContext) -> Vec<ToolDefinition> {
        self.tools
            .iter()
            .filter(|t| t.is_available(context))
            .map(|t| t.definition())
            .collect()
    }

    /// Get a tool by name
    pub fn get_tool(&self, name: &str) -> Option<&dyn BuiltinTool> {
        self.tools
            .iter()
            .find(|t| t.definition().name == name)
            .map(|t| t.as_ref())
    }

    /// Execute a tool by name
    pub async fn execute(
        &self,
        name: &str,
        arguments: serde_json::Value,
        context: &ToolContext,
    ) -> AppResult<ToolResult> {
        match self.get_tool(name) {
            Some(tool) => tool.execute(arguments, context).await,
            None => Ok(ToolResult::error(
                String::new(),
                format!("Unknown tool: {}", name),
            )),
        }
    }
}

impl BuiltinToolRegistry {
    /// Create a new registry with the same tools (for parallel execution)
    pub fn clone_registry(&self) -> Self {
        Self::new()
    }
}

impl Default for BuiltinToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
