//! Context retrieval utilities for agent pipelines
//!
//! This module provides functions for retrieving relevant code examples
//! from the codebase to enhance agent analysis.

use std::collections::HashMap;

use crate::ai::embeddings;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::github::GitHubFile;
use crate::indexer;

use super::{CodeExample, RepoContext};

/// Token budget configuration for context retrieval
#[derive(Debug, Clone)]
pub struct ContextBudget {
    /// Total token budget (~20k default)
    pub total_tokens: usize,
    /// Budget for similar code examples
    pub similar_code_tokens: usize,
    /// Budget for pattern examples
    pub pattern_tokens: usize,
    /// Budget for style exemplars
    pub style_tokens: usize,
}

impl Default for ContextBudget {
    fn default() -> Self {
        Self {
            total_tokens: 20_000,
            similar_code_tokens: 8_000,
            pattern_tokens: 8_000,
            style_tokens: 4_000,
        }
    }
}

/// Find code chunks similar to the changed files
///
/// Uses semantic search if embeddings are available, otherwise falls back
/// to filename-based search via tools.
pub async fn find_similar_code(
    pr_files: &[GitHubFile],
    repo_context: &RepoContext,
    limit: usize,
) -> AppResult<Vec<CodeExample>> {
    if repo_context.has_embeddings {
        // Use semantic search
        semantic_search_similar(pr_files, repo_context, limit).await
    } else if repo_context.repo_path.is_some() {
        // Fallback: use filename-based search
        tool_search_similar(pr_files, repo_context, limit).await
    } else {
        Ok(vec![])
    }
}

/// Find examples of specific patterns (error handling, API structure, etc.)
pub async fn retrieve_patterns(
    pr_files: &[GitHubFile],
    repo_context: &RepoContext,
    patterns: &[&str],
) -> AppResult<HashMap<String, Vec<CodeExample>>> {
    let mut results = HashMap::new();

    for pattern in patterns {
        let examples = find_pattern_examples(pattern, pr_files, repo_context, 3).await?;
        if !examples.is_empty() {
            results.insert(pattern.to_string(), examples);
        }
    }

    Ok(results)
}

/// Extract style exemplars (representative code samples for style comparison)
pub async fn extract_style_exemplars(
    pr_files: &[GitHubFile],
    repo_context: &RepoContext,
    sample_count: usize,
) -> AppResult<Vec<CodeExample>> {
    // Get file extensions from PR files
    let extensions: Vec<&str> = pr_files
        .iter()
        .filter_map(|f| f.filename.rsplit('.').next())
        .collect();

    if extensions.is_empty() {
        return Ok(vec![]);
    }

    // Find representative samples from files with same extensions
    if repo_context.has_embeddings {
        semantic_search_style_samples(&extensions, repo_context, sample_count).await
    } else if repo_context.repo_path.is_some() {
        tool_search_style_samples(&extensions, repo_context, sample_count).await
    } else {
        Ok(vec![])
    }
}

/// Truncate examples to fit within token budget
pub fn fit_to_budget(mut examples: Vec<CodeExample>, max_tokens: usize) -> Vec<CodeExample> {
    // Sort by similarity score (highest first) if available
    examples.sort_by(|a, b| {
        b.similarity_score
            .partial_cmp(&a.similarity_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut result = Vec::new();
    let mut total_tokens = 0;

    for example in examples {
        let tokens = example.estimated_tokens();
        if total_tokens + tokens <= max_tokens {
            total_tokens += tokens;
            result.push(example);
        } else if total_tokens == 0 {
            // Always include at least one example, even if it exceeds budget
            result.push(example);
            break;
        }
    }

    result
}

// ============================================================================
// Internal Implementation Functions
// ============================================================================

/// Search for similar code using embeddings
async fn semantic_search_similar(
    pr_files: &[GitHubFile],
    repo_context: &RepoContext,
    limit: usize,
) -> AppResult<Vec<CodeExample>> {
    let index_id = match &repo_context.index_id {
        Some(id) => id.to_string(),
        None => return Ok(vec![]), // No index available
    };

    let user_id = match &repo_context.tool_context {
        Some(tc) => &tc.user_id,
        None => return Ok(vec![]), // No user context
    };

    // Connect to database
    let db = Database::new()?;

    // Get the codebase index
    let repo_name = repo_context
        .repo_full_name
        .as_deref()
        .unwrap_or("unknown");

    let index = match db.get_codebase_index(user_id, repo_name)? {
        Some(idx) => idx,
        None => return Ok(vec![]),
    };

    // Get embedding provider credentials
    let (_, api_key) = match db.get_embedding_provider(user_id)? {
        Some(creds) => creds,
        None => {
            println!(
                "[Pipeline] No embedding provider configured, skipping semantic search"
            );
            return Ok(vec![]);
        }
    };

    // Get embedding provider
    let provider = match embeddings::get_provider(&index.embedding_provider) {
        Some(p) => p,
        None => {
            println!(
                "[Pipeline] Unknown embedding provider: {}",
                index.embedding_provider
            );
            return Ok(vec![]);
        }
    };

    // Build search queries from PR files
    // We'll create queries based on:
    // 1. Function/class names being modified
    // 2. Key code patterns from the diffs
    let queries = build_search_queries_from_pr(pr_files);

    if queries.is_empty() {
        return Ok(vec![]);
    }

    println!(
        "[Pipeline] Searching for similar code with {} queries",
        queries.len()
    );

    // Generate embeddings for the queries
    let query_embeddings = match provider
        .embed_texts(&api_key, &index.embedding_model, &queries)
        .await
    {
        Ok(emb) => emb,
        Err(e) => {
            println!("[Pipeline] Failed to generate query embeddings: {}", e);
            return Ok(vec![]);
        }
    };

    // Search with each query and collect results
    let mut all_results: Vec<(CodeExample, f32)> = Vec::new();
    let threshold = 0.4; // Lower threshold to get more candidates

    for (query_idx, embedding) in query_embeddings.iter().enumerate() {
        let results = indexer::semantic_search(&db, &index_id, embedding, limit, threshold)?;

        for (metadata, similarity) in results {
            let example = CodeExample {
                file_path: metadata.file_path.clone(),
                chunk_type: format!("{:?}", metadata.chunk_type).to_lowercase(),
                name: metadata.name.clone(),
                content: metadata.content.clone(),
                line_start: metadata.start_line,
                line_end: metadata.end_line,
                similarity_score: Some(similarity),
                why_relevant: Some(format!(
                    "Similar to query: '{}'",
                    queries.get(query_idx).unwrap_or(&"".to_string())
                )),
            };
            all_results.push((example, similarity));
        }
    }

    // Deduplicate by file_path + name, keeping highest similarity
    let mut deduped: HashMap<String, (CodeExample, f32)> = HashMap::new();
    for (example, similarity) in all_results {
        let key = format!("{}:{}", example.file_path, example.name);
        if let Some((_, existing_sim)) = deduped.get(&key) {
            if similarity > *existing_sim {
                deduped.insert(key, (example, similarity));
            }
        } else {
            deduped.insert(key, (example, similarity));
        }
    }

    // Sort by similarity and take top results
    let mut results: Vec<CodeExample> = deduped.into_values().map(|(e, _)| e).collect();
    results.sort_by(|a, b| {
        b.similarity_score
            .partial_cmp(&a.similarity_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);

    println!(
        "[Pipeline] Found {} similar code examples",
        results.len()
    );

    Ok(results)
}

/// Build search queries from PR files
fn build_search_queries_from_pr(pr_files: &[GitHubFile]) -> Vec<String> {
    let mut queries = Vec::new();

    for file in pr_files {
        // Add filename-based query
        let filename = file.filename.rsplit('/').next().unwrap_or(&file.filename);
        let name_without_ext = filename.rsplit('.').last().unwrap_or(filename);

        // Generate contextual queries based on filename patterns
        if filename.contains("Service") || filename.contains("service") {
            queries.push(format!("service implementation like {}", name_without_ext));
        } else if filename.contains("Controller") || filename.contains("controller") {
            queries.push(format!("controller handler like {}", name_without_ext));
        } else if filename.contains("Repository") || filename.contains("repository") {
            queries.push(format!("repository data access like {}", name_without_ext));
        } else if filename.contains("Component") || filename.ends_with(".tsx") {
            queries.push(format!("React component like {}", name_without_ext));
        } else if filename.ends_with(".rs") {
            queries.push(format!("Rust module {}", name_without_ext));
        }

        // Extract function/method names from diff if available
        if let Some(patch) = &file.patch {
            let func_names = extract_function_names_from_patch(patch);
            for name in func_names.iter().take(3) {
                // Limit per file
                queries.push(format!("function {}", name));
            }
        }
    }

    // Limit total queries
    queries.truncate(5);
    queries
}

/// Extract function/method names from a diff patch
fn extract_function_names_from_patch(patch: &str) -> Vec<String> {
    let mut names = Vec::new();

    for line in patch.lines() {
        if !line.starts_with('+') && !line.starts_with('-') {
            continue;
        }

        // Common patterns for function definitions
        // Rust: fn name(
        // TypeScript/JavaScript: function name( or async function name( or name = ( or name(
        // Python: def name(

        let trimmed = line.trim_start_matches(['+', '-', ' ', '\t'].as_ref());

        // Rust/Go
        if trimmed.starts_with("fn ") || trimmed.starts_with("func ") {
            if let Some(name) = extract_name_before_paren(trimmed, &["fn ", "func "]) {
                names.push(name);
            }
        }
        // Python
        else if trimmed.starts_with("def ") || trimmed.starts_with("async def ") {
            if let Some(name) = extract_name_before_paren(trimmed, &["def ", "async def "]) {
                names.push(name);
            }
        }
        // JavaScript/TypeScript
        else if trimmed.starts_with("function ")
            || trimmed.starts_with("async function ")
            || trimmed.contains("const ") && trimmed.contains(" = (")
        {
            if let Some(name) =
                extract_name_before_paren(trimmed, &["function ", "async function "])
            {
                names.push(name);
            }
        }
    }

    names
}

/// Extract name before opening parenthesis
fn extract_name_before_paren(line: &str, prefixes: &[&str]) -> Option<String> {
    let mut s = line;
    for prefix in prefixes {
        if s.starts_with(prefix) {
            s = &s[prefix.len()..];
            break;
        }
    }

    if let Some(paren_pos) = s.find('(') {
        let name = s[..paren_pos].trim();
        if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Some(name.to_string());
        }
    }

    None
}

/// Search for similar code using filename patterns (fallback when no embeddings)
async fn tool_search_similar(
    pr_files: &[GitHubFile],
    repo_context: &RepoContext,
    limit: usize,
) -> AppResult<Vec<CodeExample>> {
    // For now, this is a stub - would need to implement using search_repo tool
    // The full implementation would:
    // 1. Analyze PR filenames to determine patterns (Service, Controller, etc.)
    // 2. Use search_repo to find similar files
    // 3. Read and parse those files
    // 4. Return as CodeExamples

    let _ = (pr_files, repo_context, limit);
    println!("[Pipeline] Tool-based search not yet implemented, using semantic search only");
    Ok(vec![])
}

/// Find examples of a specific pattern using semantic search
async fn find_pattern_examples(
    pattern: &str,
    _pr_files: &[GitHubFile],
    repo_context: &RepoContext,
    limit: usize,
) -> AppResult<Vec<CodeExample>> {
    // Map pattern names to semantic search queries
    let query = match pattern {
        "error_handling" => "error handling try catch Result Err exception throw",
        "authentication" => "authentication login token session auth middleware verify",
        "authorization" => "authorization permission role access control policy",
        "input_validation" => "validate input sanitize check parameter argument schema",
        "api_structure" => "route handler endpoint controller request response REST API",
        "dependency_injection" => "inject dependency provider service factory container",
        "caching" => "cache memo memoize store retrieve invalidate ttl",
        "database_queries" => "query select insert update delete database SQL transaction",
        "async_patterns" => "async await promise future spawn concurrent parallel",
        "crypto" => "encrypt decrypt hash sign verify cipher key secret",
        _ => pattern, // Use pattern directly as query
    };

    // Use semantic search with the pattern query
    let index_id = match &repo_context.index_id {
        Some(id) => id.to_string(),
        None => return Ok(vec![]),
    };

    let user_id = match &repo_context.tool_context {
        Some(tc) => &tc.user_id,
        None => return Ok(vec![]),
    };

    let db = Database::new()?;

    let repo_name = repo_context.repo_full_name.as_deref().unwrap_or("unknown");
    let index = match db.get_codebase_index(user_id, repo_name)? {
        Some(idx) => idx,
        None => return Ok(vec![]),
    };

    let (_, api_key) = match db.get_embedding_provider(user_id)? {
        Some(creds) => creds,
        None => return Ok(vec![]),
    };

    let provider = match embeddings::get_provider(&index.embedding_provider) {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    // Generate embedding for the pattern query
    let query_embeddings = match provider
        .embed_texts(&api_key, &index.embedding_model, &[query.to_string()])
        .await
    {
        Ok(emb) => emb,
        Err(e) => {
            println!("[Pipeline] Failed to generate pattern embedding: {}", e);
            return Ok(vec![]);
        }
    };

    if query_embeddings.is_empty() {
        return Ok(vec![]);
    }

    let results = indexer::semantic_search(&db, &index_id, &query_embeddings[0], limit, 0.35)?;

    let examples: Vec<CodeExample> = results
        .into_iter()
        .map(|(metadata, similarity)| CodeExample {
            file_path: metadata.file_path,
            chunk_type: format!("{:?}", metadata.chunk_type).to_lowercase(),
            name: metadata.name,
            content: metadata.content,
            line_start: metadata.start_line,
            line_end: metadata.end_line,
            similarity_score: Some(similarity),
            why_relevant: Some(format!("Matches {} pattern", pattern)),
        })
        .collect();

    println!(
        "[Pipeline] Found {} examples for pattern '{}'",
        examples.len(),
        pattern
    );

    Ok(examples)
}

/// Search for style samples using embeddings
async fn semantic_search_style_samples(
    extensions: &[&str],
    repo_context: &RepoContext,
    sample_count: usize,
) -> AppResult<Vec<CodeExample>> {
    // Build queries to find well-documented, representative code
    let queries: Vec<String> = extensions
        .iter()
        .flat_map(|ext| {
            vec![
                format!("well documented {} function with comments", ext),
                format!("clean {} code with docstring", ext),
            ]
        })
        .take(3)
        .collect();

    if queries.is_empty() {
        return Ok(vec![]);
    }

    let index_id = match &repo_context.index_id {
        Some(id) => id.to_string(),
        None => return Ok(vec![]),
    };

    let user_id = match &repo_context.tool_context {
        Some(tc) => &tc.user_id,
        None => return Ok(vec![]),
    };

    let db = Database::new()?;

    let repo_name = repo_context.repo_full_name.as_deref().unwrap_or("unknown");
    let index = match db.get_codebase_index(user_id, repo_name)? {
        Some(idx) => idx,
        None => return Ok(vec![]),
    };

    let (_, api_key) = match db.get_embedding_provider(user_id)? {
        Some(creds) => creds,
        None => return Ok(vec![]),
    };

    let provider = match embeddings::get_provider(&index.embedding_provider) {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let query_embeddings = match provider
        .embed_texts(&api_key, &index.embedding_model, &queries)
        .await
    {
        Ok(emb) => emb,
        Err(e) => {
            println!("[Pipeline] Failed to generate style embedding: {}", e);
            return Ok(vec![]);
        }
    };

    let mut all_results: Vec<CodeExample> = Vec::new();

    for embedding in &query_embeddings {
        let results = indexer::semantic_search(&db, &index_id, embedding, sample_count, 0.3)?;

        for (metadata, similarity) in results {
            // Filter by matching extensions
            let file_ext = metadata.file_path.rsplit('.').next().unwrap_or("");
            if extensions.iter().any(|ext| *ext == file_ext) {
                all_results.push(CodeExample {
                    file_path: metadata.file_path,
                    chunk_type: format!("{:?}", metadata.chunk_type).to_lowercase(),
                    name: metadata.name,
                    content: metadata.content,
                    line_start: metadata.start_line,
                    line_end: metadata.end_line,
                    similarity_score: Some(similarity),
                    why_relevant: Some("Style exemplar".to_string()),
                });
            }
        }
    }

    // Deduplicate and limit
    let mut seen = std::collections::HashSet::new();
    all_results.retain(|e| {
        let key = format!("{}:{}", e.file_path, e.name);
        seen.insert(key)
    });
    all_results.truncate(sample_count);

    println!(
        "[Pipeline] Found {} style exemplars",
        all_results.len()
    );

    Ok(all_results)
}

/// Search for style samples using filename patterns (fallback)
async fn tool_search_style_samples(
    extensions: &[&str],
    repo_context: &RepoContext,
    sample_count: usize,
) -> AppResult<Vec<CodeExample>> {
    // Fallback stub - would use search_repo and read_file tools
    let _ = (extensions, repo_context, sample_count);
    println!("[Pipeline] Tool-based style search not yet implemented");
    Ok(vec![])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fit_to_budget_empty() {
        let examples: Vec<CodeExample> = vec![];
        let result = fit_to_budget(examples, 1000);
        assert!(result.is_empty());
    }

    #[test]
    fn test_fit_to_budget_single_large() {
        let examples = vec![CodeExample {
            file_path: "test.rs".to_string(),
            chunk_type: "function".to_string(),
            name: "test_fn".to_string(),
            content: "a".repeat(10000), // ~2500 tokens
            line_start: 1,
            line_end: 100,
            similarity_score: Some(0.9),
            why_relevant: None,
        }];

        // Should include at least one example even if it exceeds budget
        let result = fit_to_budget(examples, 100);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_fit_to_budget_prioritizes_similarity() {
        let examples = vec![
            CodeExample {
                file_path: "low.rs".to_string(),
                chunk_type: "function".to_string(),
                name: "low_similarity".to_string(),
                content: "small".to_string(),
                line_start: 1,
                line_end: 5,
                similarity_score: Some(0.3),
                why_relevant: None,
            },
            CodeExample {
                file_path: "high.rs".to_string(),
                chunk_type: "function".to_string(),
                name: "high_similarity".to_string(),
                content: "small".to_string(),
                line_start: 1,
                line_end: 5,
                similarity_score: Some(0.9),
                why_relevant: None,
            },
        ];

        let result = fit_to_budget(examples, 100);
        assert!(!result.is_empty());
        // First result should be the one with higher similarity
        assert_eq!(result[0].name, "high_similarity");
    }
}
