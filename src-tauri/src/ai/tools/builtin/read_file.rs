//! read_file tool - Read files from the local repository

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::Path;

use super::BuiltinTool;
use crate::ai::tools::{ToolContext, ToolDefinition, ToolResult, ToolSource};
use crate::error::{AppError, AppResult};

const MAX_FILE_SIZE: u64 = 100_000; // 100KB
const MAX_LINES: usize = 1000;

#[derive(Debug, Deserialize)]
struct ReadFileArgs {
    path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
}

pub struct ReadFileTool;

impl ReadFileTool {
    pub fn new() -> Self {
        Self
    }

    fn is_path_safe(repo_path: &Path, file_path: &Path) -> bool {
        // Canonicalize both paths and ensure the file is within the repo
        let repo_canonical = match repo_path.canonicalize() {
            Ok(p) => p,
            Err(_) => return false,
        };

        let file_canonical = match file_path.canonicalize() {
            Ok(p) => p,
            Err(_) => return false,
        };

        file_canonical.starts_with(&repo_canonical)
    }

    fn is_binary_file(content: &[u8]) -> bool {
        // Check first 8KB for null bytes (common indicator of binary)
        let check_len = content.len().min(8192);
        content[..check_len].iter().any(|&b| b == 0)
    }
}

impl Default for ReadFileTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BuiltinTool for ReadFileTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "read_file".to_string(),
            description: "Read the contents of a file from the local repository. Returns the file content with line numbers.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file relative to repository root"
                    },
                    "start_line": {
                        "type": "integer",
                        "description": "Optional start line (1-indexed). Default: 1"
                    },
                    "end_line": {
                        "type": "integer",
                        "description": "Optional end line (1-indexed, inclusive). Default: read all lines"
                    }
                },
                "required": ["path"]
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

        let args: ReadFileArgs = serde_json::from_value(arguments).map_err(|e| {
            AppError::ToolExecution(format!("Invalid arguments: {}", e))
        })?;

        let repo_path = context.repo_path.as_ref().ok_or_else(|| {
            AppError::ToolExecution("No repository path available".to_string())
        })?;

        let repo_path = Path::new(repo_path);

        // Normalize the file path and join with repo path
        let file_path = if args.path.starts_with('/') || args.path.starts_with('\\') {
            repo_path.join(&args.path[1..])
        } else {
            repo_path.join(&args.path)
        };

        // Security check: ensure path is within repository
        if !Self::is_path_safe(repo_path, &file_path) {
            return Ok(ToolResult::error(
                call_id,
                "Access denied: path is outside repository".to_string(),
            ));
        }

        if !file_path.exists() {
            return Ok(ToolResult::error(
                call_id,
                format!("File not found: {}", args.path),
            ));
        }

        if !file_path.is_file() {
            return Ok(ToolResult::error(
                call_id,
                format!("Not a file: {}", args.path),
            ));
        }

        // Check file size
        let metadata = file_path.metadata().map_err(|e| {
            AppError::ToolExecution(format!("Failed to read file metadata: {}", e))
        })?;

        if metadata.len() > MAX_FILE_SIZE {
            return Ok(ToolResult::error(
                call_id,
                format!(
                    "File too large ({} bytes). Maximum size: {} bytes. Use start_line/end_line to read a portion.",
                    metadata.len(),
                    MAX_FILE_SIZE
                ),
            ));
        }

        // Read file content
        let content_bytes = fs::read(&file_path).map_err(|e| {
            AppError::ToolExecution(format!("Failed to read file: {}", e))
        })?;

        // Check for binary content
        if Self::is_binary_file(&content_bytes) {
            return Ok(ToolResult::error(
                call_id,
                "Cannot read binary file".to_string(),
            ));
        }

        let content = String::from_utf8_lossy(&content_bytes);
        let lines: Vec<&str> = content.lines().collect();

        // Apply line range
        let start = args.start_line.unwrap_or(1).saturating_sub(1);
        let end = args.end_line.unwrap_or(lines.len()).min(lines.len());

        if start >= lines.len() {
            return Ok(ToolResult::error(
                call_id,
                format!(
                    "start_line {} is beyond file length ({} lines)",
                    start + 1,
                    lines.len()
                ),
            ));
        }

        let selected_lines: Vec<&str> = lines[start..end].to_vec();
        let line_count = selected_lines.len();

        // Truncate if too many lines
        let (selected_lines, truncated) = if line_count > MAX_LINES {
            (selected_lines[..MAX_LINES].to_vec(), true)
        } else {
            (selected_lines, false)
        };

        // Format output with line numbers
        let mut output = format!("# File: {}\n", args.path);
        output.push_str(&format!(
            "# Lines: {}-{} of {}\n",
            start + 1,
            start + selected_lines.len(),
            lines.len()
        ));

        if truncated {
            output.push_str(&format!(
                "# Note: Output truncated to {} lines\n",
                MAX_LINES
            ));
        }

        output.push_str("\n");

        for (idx, line) in selected_lines.iter().enumerate() {
            output.push_str(&format!("{:>6} | {}\n", start + idx + 1, line));
        }

        Ok(ToolResult::success(call_id, output))
    }
}
