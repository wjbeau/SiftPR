//! search_repo tool - Search for patterns in the local repository

use async_trait::async_trait;
use ignore::WalkBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::Path;

use super::BuiltinTool;
use crate::ai::tools::{ToolContext, ToolDefinition, ToolResult, ToolSource};
use crate::error::{AppError, AppResult};

const MAX_RESULTS: usize = 100;
const MAX_LINE_LENGTH: usize = 500;
const MAX_OUTPUT_SIZE: usize = 50_000; // 50KB

#[derive(Debug, Deserialize)]
struct SearchArgs {
    pattern: String,
    file_pattern: Option<String>,
    max_results: Option<usize>,
    context_lines: Option<usize>,
}

#[derive(Debug, Serialize)]
struct SearchMatch {
    file: String,
    line_number: usize,
    line_content: String,
    context_before: Vec<String>,
    context_after: Vec<String>,
}

#[derive(Debug, Serialize)]
struct SearchOutput {
    matches: Vec<SearchMatch>,
    total_files_searched: usize,
    truncated: bool,
}

pub struct SearchRepoTool;

impl SearchRepoTool {
    pub fn new() -> Self {
        Self
    }

    fn search_in_file(
        &self,
        file_path: &Path,
        regex: &Regex,
        context_lines: usize,
        repo_path: &Path,
    ) -> Vec<SearchMatch> {
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => return vec![], // Skip binary or unreadable files
        };

        let lines: Vec<&str> = content.lines().collect();
        let mut matches = Vec::new();

        for (idx, line) in lines.iter().enumerate() {
            if regex.is_match(line) {
                let relative_path = file_path
                    .strip_prefix(repo_path)
                    .unwrap_or(file_path)
                    .to_string_lossy()
                    .to_string();

                // Get context lines
                let start = idx.saturating_sub(context_lines);
                let end = (idx + context_lines + 1).min(lines.len());

                let context_before: Vec<String> = lines[start..idx]
                    .iter()
                    .map(|l| truncate_line(l, MAX_LINE_LENGTH))
                    .collect();

                let context_after: Vec<String> = lines[(idx + 1)..end]
                    .iter()
                    .map(|l| truncate_line(l, MAX_LINE_LENGTH))
                    .collect();

                matches.push(SearchMatch {
                    file: relative_path,
                    line_number: idx + 1,
                    line_content: truncate_line(line, MAX_LINE_LENGTH),
                    context_before,
                    context_after,
                });
            }
        }

        matches
    }
}

impl Default for SearchRepoTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BuiltinTool for SearchRepoTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "search_repo".to_string(),
            description: "Search for patterns in the local repository using regex. Returns matching file paths, line numbers, and content with context.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for"
                    },
                    "file_pattern": {
                        "type": "string",
                        "description": "Optional glob pattern to filter files (e.g., '*.rs', 'src/**/*.ts')"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 50, max: 100)"
                    },
                    "context_lines": {
                        "type": "integer",
                        "description": "Number of context lines before/after each match (default: 2, max: 5)"
                    }
                },
                "required": ["pattern"]
            }),
            source: ToolSource::Builtin,
        }
    }

    fn is_available(&self, context: &ToolContext) -> bool {
        context.repo_path.is_some()
    }

    async fn execute(
        &self,
        arguments: serde_json::Value,
        context: &ToolContext,
    ) -> AppResult<ToolResult> {
        let call_id = uuid::Uuid::new_v4().to_string();

        let args: SearchArgs = serde_json::from_value(arguments).map_err(|e| {
            AppError::ToolExecution(format!("Invalid arguments: {}", e))
        })?;

        let repo_path = context.repo_path.as_ref().ok_or_else(|| {
            AppError::ToolExecution("No repository path available".to_string())
        })?;

        let repo_path = Path::new(repo_path);
        if !repo_path.exists() {
            return Ok(ToolResult::error(
                call_id,
                format!("Repository path does not exist: {}", repo_path.display()),
            ));
        }

        // Compile regex
        let regex = Regex::new(&args.pattern).map_err(|e| {
            AppError::ToolExecution(format!("Invalid regex pattern: {}", e))
        })?;

        let max_results = args.max_results.unwrap_or(50).min(MAX_RESULTS);
        let context_lines = args.context_lines.unwrap_or(2).min(5);

        // Build file walker
        let mut walker = WalkBuilder::new(repo_path);
        walker
            .hidden(true)
            .ignore(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true);

        // Apply file pattern filter if provided
        let file_glob = if let Some(ref pattern) = args.file_pattern {
            Some(
                globset::GlobBuilder::new(pattern)
                    .literal_separator(true)
                    .build()
                    .map_err(|e| AppError::ToolExecution(format!("Invalid file pattern: {}", e)))?
                    .compile_matcher(),
            )
        } else {
            None
        };

        let mut all_matches = Vec::new();
        let mut total_files = 0;
        let mut output_size = 0;
        let mut truncated = false;

        for entry in walker.build() {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // Apply file pattern filter
            if let Some(ref glob) = file_glob {
                let relative = path.strip_prefix(repo_path).unwrap_or(path);
                if !glob.is_match(relative) {
                    continue;
                }
            }

            // Skip binary and large files
            if let Ok(metadata) = path.metadata() {
                if metadata.len() > 1_000_000 {
                    // Skip files > 1MB
                    continue;
                }
            }

            total_files += 1;
            let matches = self.search_in_file(path, &regex, context_lines, repo_path);

            for m in matches {
                // Estimate output size
                let match_size = m.file.len()
                    + m.line_content.len()
                    + m.context_before.iter().map(|s| s.len()).sum::<usize>()
                    + m.context_after.iter().map(|s| s.len()).sum::<usize>()
                    + 100; // JSON overhead

                output_size += match_size;

                if all_matches.len() >= max_results || output_size > MAX_OUTPUT_SIZE {
                    truncated = true;
                    break;
                }

                all_matches.push(m);
            }

            if truncated {
                break;
            }
        }

        let output = SearchOutput {
            matches: all_matches,
            total_files_searched: total_files,
            truncated,
        };

        let json_output = serde_json::to_string_pretty(&output)
            .map_err(|e| AppError::ToolExecution(format!("Failed to serialize output: {}", e)))?;

        Ok(ToolResult::success(call_id, json_output))
    }
}

fn truncate_line(line: &str, max_len: usize) -> String {
    if line.len() > max_len {
        format!("{}...", &line[..max_len])
    } else {
        line.to_string()
    }
}
