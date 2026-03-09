//! Code parsing module using Tree-sitter for multi-language AST analysis.
//!
//! This module extracts code chunks (functions, methods, classes, etc.) from source files
//! for semantic indexing.

pub mod chunker;
pub mod languages;

use std::path::Path;

use crate::db::ChunkType;
use crate::error::{AppError, AppResult};

/// Represents an extracted code chunk from a source file
#[derive(Debug, Clone)]
pub struct CodeChunk {
    pub file_path: String,
    pub chunk_type: ChunkType,
    pub name: String,
    pub signature: Option<String>,
    pub language: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub docstring: Option<String>,
    pub parent_name: Option<String>,
    pub visibility: Option<String>,
}

impl CodeChunk {
    /// Generate embedding-friendly text representation
    pub fn to_embedding_text(&self) -> String {
        let mut parts = Vec::new();

        // Header with language and type
        if let Some(ref sig) = self.signature {
            parts.push(format!("{} {}: {}", self.language, self.chunk_type.as_str(), sig));
        } else {
            parts.push(format!("{} {}: {}", self.language, self.chunk_type.as_str(), self.name));
        }

        // Docstring if present
        if let Some(ref doc) = self.docstring {
            parts.push(String::new());
            parts.push(doc.clone());
        }

        // Code content
        parts.push(String::new());
        parts.push(self.content.clone());

        parts.join("\n")
    }
}

/// Supported programming languages
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Language {
    Rust,
    TypeScript,
    JavaScript,
    Python,
    Go,
    Unknown,
}

impl Language {
    /// Detect language from file extension
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "rs" => Language::Rust,
            "ts" | "tsx" => Language::TypeScript,
            "js" | "jsx" | "mjs" | "cjs" => Language::JavaScript,
            "py" | "pyi" => Language::Python,
            "go" => Language::Go,
            _ => Language::Unknown,
        }
    }

    /// Get language name as string
    pub fn as_str(&self) -> &'static str {
        match self {
            Language::Rust => "rust",
            Language::TypeScript => "typescript",
            Language::JavaScript => "javascript",
            Language::Python => "python",
            Language::Go => "go",
            Language::Unknown => "unknown",
        }
    }
}

/// Detect language from file path
pub fn detect_language(path: &Path) -> Language {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(Language::from_extension)
        .unwrap_or(Language::Unknown)
}

/// Check if a file should be parsed (based on extension)
pub fn is_parseable_file(path: &Path) -> bool {
    detect_language(path) != Language::Unknown
}

/// Default exclude patterns for indexing
pub const DEFAULT_EXCLUDE_PATTERNS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    "__pycache__",
    "venv",
    ".venv",
    "vendor",
    ".next",
    ".nuxt",
    "coverage",
    ".nyc_output",
];

/// Check if a path should be excluded from indexing
pub fn should_exclude(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            if let Some(name_str) = name.to_str() {
                // Skip hidden directories
                if name_str.starts_with('.') && name_str != "." {
                    return true;
                }
                // Skip excluded patterns
                if DEFAULT_EXCLUDE_PATTERNS.contains(&name_str) {
                    return true;
                }
            }
        }
    }
    false
}

/// Extract code chunks from a source file
pub fn extract_chunks_from_file(path: &Path) -> AppResult<Vec<CodeChunk>> {
    let language = detect_language(path);
    if language == Language::Unknown {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::Parser(format!("Failed to read file {}: {}", path.display(), e)))?;

    chunker::extract_chunks(&content, language, path)
}
