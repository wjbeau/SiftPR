//! semantic_search tool - Search codebase using semantic embeddings
//!
//! This tool allows agents to find code that is semantically similar to a query,
//! enabling them to detect patterns, inconsistencies, and related implementations.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::BuiltinTool;
use crate::ai::embeddings::{self, EmbeddingProvider};
use crate::ai::tools::{ToolContext, ToolDefinition, ToolResult, ToolSource};
use crate::db::{ChunkType, Database};
use crate::error::{AppError, AppResult};
use crate::indexer;

const MAX_RESULTS: usize = 20;
const DEFAULT_THRESHOLD: f32 = 0.5;

#[derive(Debug, Deserialize)]
struct SemanticSearchArgs {
    /// Natural language query or code snippet to search for
    query: String,
    /// Optional filter by chunk type (function, method, class, struct, interface, enum, trait, module)
    chunk_types: Option<Vec<String>>,
    /// Maximum number of results (default: 10, max: 20)
    limit: Option<usize>,
    /// Similarity threshold 0-1 (default: 0.5)
    threshold: Option<f32>,
}

#[derive(Debug, Serialize)]
struct SearchResult {
    file_path: String,
    name: String,
    chunk_type: String,
    signature: Option<String>,
    language: String,
    start_line: u32,
    end_line: u32,
    content: String,
    docstring: Option<String>,
    similarity: f32,
}

#[derive(Debug, Serialize)]
struct SearchOutput {
    results: Vec<SearchResult>,
    query: String,
    total_indexed_chunks: u32,
}

pub struct SemanticSearchTool;

impl SemanticSearchTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SemanticSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BuiltinTool for SemanticSearchTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "semantic_search".to_string(),
            description: "Search the indexed codebase for code semantically similar to a query. \
                Use this to find related implementations, patterns, or code that might be \
                inconsistent with new changes. Requires the repository to be indexed first.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language description or code snippet to search for. \
                            Examples: 'error handling patterns', 'authentication middleware', \
                            'database connection pooling'"
                    },
                    "chunk_types": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["function", "method", "class", "struct", "interface", "enum", "trait", "module"]
                        },
                        "description": "Filter results by code chunk type"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 10, max: 20)"
                    },
                    "threshold": {
                        "type": "number",
                        "description": "Minimum similarity score 0-1 (default: 0.5)"
                    }
                },
                "required": ["query"]
            }),
            source: ToolSource::Builtin,
        }
    }

    fn is_available(&self, context: &ToolContext) -> bool {
        // Available if we have a repo linked (we'll create our own DB connection)
        context.repo_full_name.is_some()
    }

    async fn execute(
        &self,
        arguments: serde_json::Value,
        context: &ToolContext,
    ) -> AppResult<ToolResult> {
        let call_id = uuid::Uuid::new_v4().to_string();

        let args: SemanticSearchArgs = serde_json::from_value(arguments).map_err(|e| {
            AppError::ToolExecution(format!("Invalid arguments: {}", e))
        })?;

        let repo_full_name = context.repo_full_name.as_ref().ok_or_else(|| {
            AppError::ToolExecution("Repository name not available".to_string())
        })?;

        // Create a new database connection for this async operation
        // (rusqlite connections aren't Send, so we create one per tool execution)
        let db = Database::new().map_err(|e| {
            AppError::ToolExecution(format!("Failed to connect to database: {}", e))
        })?;

        // Get the index for this repository
        let index = db.get_codebase_index(&context.user_id, repo_full_name)?
            .ok_or_else(|| {
                AppError::ToolExecution(format!(
                    "Repository '{}' is not indexed. Please index the repository first.",
                    repo_full_name
                ))
            })?;

        if index.index_status != crate::db::IndexStatus::Complete {
            return Ok(ToolResult::error(
                call_id,
                format!(
                    "Repository index is not ready. Status: {:?}",
                    index.index_status
                ),
            ));
        }

        // Get the embedding provider (decoupled from review AI provider)
        let (_, api_key) = db.get_embedding_provider(&context.user_id)?
            .ok_or_else(|| {
                AppError::ToolExecution(
                    "No embedding-capable AI provider configured. Add an OpenAI or Google API key in Settings.".to_string()
                )
            })?;

        // Get embedding provider
        let provider = embeddings::get_provider(&index.embedding_provider)
            .ok_or_else(|| {
                AppError::ToolExecution(format!(
                    "Unknown embedding provider: {}",
                    index.embedding_provider
                ))
            })?;

        // Generate embedding for the query
        let query_embeddings = provider
            .embed_texts(&api_key, &index.embedding_model, &[args.query.clone()])
            .await?;

        if query_embeddings.is_empty() {
            return Ok(ToolResult::error(
                call_id,
                "Failed to generate embedding for query".to_string(),
            ));
        }

        let limit = args.limit.unwrap_or(10).min(MAX_RESULTS);
        let threshold = args.threshold.unwrap_or(DEFAULT_THRESHOLD).clamp(0.0, 1.0);

        // Perform semantic search
        let search_results = indexer::semantic_search(
            &db,
            &index.id,
            &query_embeddings[0],
            limit,
            threshold,
        )?;

        // Filter by chunk types if specified
        let filtered_results: Vec<_> = if let Some(ref types) = args.chunk_types {
            let type_set: std::collections::HashSet<_> = types.iter()
                .filter_map(|t| match t.as_str() {
                    "function" => Some(ChunkType::Function),
                    "method" => Some(ChunkType::Method),
                    "class" => Some(ChunkType::Class),
                    "struct" => Some(ChunkType::Struct),
                    "interface" => Some(ChunkType::Interface),
                    "enum" => Some(ChunkType::Enum),
                    "trait" => Some(ChunkType::Trait),
                    "module" => Some(ChunkType::Module),
                    _ => None,
                })
                .collect();

            search_results
                .into_iter()
                .filter(|(meta, _)| type_set.contains(&meta.chunk_type))
                .collect()
        } else {
            search_results
        };

        // Format results
        let results: Vec<SearchResult> = filtered_results
            .into_iter()
            .map(|(meta, similarity)| SearchResult {
                file_path: meta.file_path,
                name: meta.name,
                chunk_type: format!("{:?}", meta.chunk_type).to_lowercase(),
                signature: meta.signature,
                language: meta.language,
                start_line: meta.start_line,
                end_line: meta.end_line,
                content: truncate_content(&meta.content, 1000),
                docstring: meta.docstring,
                similarity,
            })
            .collect();

        let output = SearchOutput {
            results,
            query: args.query,
            total_indexed_chunks: index.total_chunks,
        };

        let json_output = serde_json::to_string_pretty(&output)
            .map_err(|e| AppError::ToolExecution(format!("Failed to serialize output: {}", e)))?;

        Ok(ToolResult::success(call_id, json_output))
    }
}

fn truncate_content(content: &str, max_len: usize) -> String {
    if content.len() > max_len {
        format!("{}...", &content[..max_len])
    } else {
        content.to_string()
    }
}
