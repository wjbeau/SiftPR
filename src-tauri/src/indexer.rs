//! Codebase indexing orchestration
//!
//! This module coordinates the full indexing process:
//! 1. Parse source files with Tree-sitter
//! 2. Generate embeddings with the configured AI provider
//! 3. Store chunks and embeddings in the database

use std::path::Path;

use crate::ai::embeddings::{self, EmbeddingProvider};
use crate::db::{ChunkType, CodebaseIndex, Database, IndexStatus};
use crate::error::{AppError, AppResult};
use crate::parser::{self, CodeChunk};

/// Result of an indexing operation
#[derive(Debug)]
pub struct IndexingResult {
    pub chunks_indexed: usize,
    pub files_processed: usize,
    pub errors: Vec<String>,
}

/// Batch size for embedding API calls
const EMBEDDING_BATCH_SIZE: usize = 50;

/// Index a repository
pub async fn index_repository(
    db: &Database,
    user_id: &str,
    repo_full_name: &str,
    local_path: &str,
    embedding_provider: &str,
    embedding_model: &str,
    api_key: &str,
) -> AppResult<IndexingResult> {
    let path = Path::new(local_path);

    if !path.exists() {
        return Err(AppError::Indexing(format!(
            "Repository path does not exist: {}",
            local_path
        )));
    }

    // Get or create index
    let dimensions = embeddings::get_dimensions(embedding_provider, embedding_model);
    let index = db.create_codebase_index(
        user_id,
        repo_full_name,
        local_path,
        embedding_provider,
        embedding_model,
        dimensions as u32,
    )?;

    // Update status to indexing
    db.update_index_status(&index.id, IndexStatus::Indexing, None)?;

    // Clear existing chunks
    db.clear_chunks_for_index(&index.id)?;

    // Collect all source files
    let files = collect_source_files(path)?;
    let files_total = files.len() as u32;

    // Store files_total and reset progress
    db.update_index_progress(&index.id, files_total, 0, 0)?;

    // Parse all files to extract chunks
    let mut all_chunks: Vec<CodeChunk> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut files_processed: u32 = 0;

    for file_path in &files {
        match parser::extract_chunks_from_file(file_path) {
            Ok(chunks) => {
                all_chunks.extend(chunks);
                files_processed += 1;
            }
            Err(e) => {
                errors.push(format!("{}: {}", file_path.display(), e));
                files_processed += 1;
            }
        }

        // Update progress every 10 files
        if files_processed % 10 == 0 || files_processed == files_total {
            let _ = db.update_index_progress(&index.id, files_total, files_processed, 0);
        }
    }

    if all_chunks.is_empty() {
        db.update_index_status(&index.id, IndexStatus::Complete, None)?;
        return Ok(IndexingResult {
            chunks_indexed: 0,
            files_processed: files_processed as usize,
            errors,
        });
    }

    // Get embedding provider
    let provider = embeddings::get_provider(embedding_provider)
        .ok_or_else(|| AppError::Embedding(format!("Unknown provider: {}", embedding_provider)))?;

    // Generate embeddings in batches
    let mut chunks_indexed: u32 = 0;

    for batch in all_chunks.chunks(EMBEDDING_BATCH_SIZE) {
        // Prepare texts for embedding
        let texts: Vec<String> = batch.iter().map(|c| c.to_embedding_text()).collect();

        // Generate embeddings
        let embeddings = match provider.embed_texts(api_key, embedding_model, &texts).await {
            Ok(emb) => emb,
            Err(e) => {
                db.update_index_status(&index.id, IndexStatus::Failed, Some(&e.to_string()))?;
                return Err(e);
            }
        };

        // Store chunks with embeddings
        for (chunk, embedding) in batch.iter().zip(embeddings.iter()) {
            db.insert_chunk(
                &index.id,
                &chunk.file_path,
                &chunk.chunk_type,
                &chunk.name,
                chunk.signature.as_deref(),
                &chunk.language,
                chunk.start_line,
                chunk.end_line,
                &chunk.content,
                chunk.docstring.as_deref(),
                chunk.parent_name.as_deref(),
                chunk.visibility.as_deref(),
                embedding,
            )?;
            chunks_indexed += 1;
        }

        // Update progress after each batch
        let _ = db.update_index_progress(&index.id, files_total, files_processed, chunks_indexed);
    }

    // Get current HEAD commit
    let commit_sha = crate::codebase::get_head_commit(local_path)
        .unwrap_or_else(|_| "unknown".to_string());

    // Update status to complete
    db.update_index_complete(&index.id, &commit_sha, chunks_indexed)?;

    Ok(IndexingResult {
        chunks_indexed: chunks_indexed as usize,
        files_processed: files_processed as usize,
        errors,
    })
}

/// Collect all parseable source files in a directory
fn collect_source_files(root: &Path) -> AppResult<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    collect_files_recursive(root, root, &mut files)?;
    Ok(files)
}

fn collect_files_recursive(
    root: &Path,
    current: &Path,
    files: &mut Vec<std::path::PathBuf>,
) -> AppResult<()> {
    if !current.is_dir() {
        return Ok(());
    }

    let entries = std::fs::read_dir(current)
        .map_err(|e| AppError::Indexing(format!("Failed to read directory: {}", e)))?;

    for entry in entries {
        let entry = entry.map_err(|e| AppError::Indexing(format!("Failed to read entry: {}", e)))?;
        let path = entry.path();

        // Get relative path for exclusion check
        let relative = path.strip_prefix(root).unwrap_or(&path);

        if parser::should_exclude(relative) {
            continue;
        }

        if path.is_dir() {
            collect_files_recursive(root, &path, files)?;
        } else if path.is_file() && parser::is_parseable_file(&path) {
            files.push(path);
        }
    }

    Ok(())
}

/// Perform semantic search on indexed chunks
pub fn semantic_search(
    db: &Database,
    index_id: &str,
    query_embedding: &[f32],
    limit: usize,
    threshold: f32,
) -> AppResult<Vec<(crate::db::ChunkMetadata, f32)>> {
    // Load all chunks and their embeddings
    let chunks = db.get_all_chunks_for_index(index_id)?;

    // Calculate similarity scores
    let mut scored: Vec<_> = chunks
        .into_iter()
        .map(|(metadata, embedding)| {
            let similarity = embeddings::cosine_similarity(query_embedding, &embedding);
            (metadata, similarity)
        })
        .filter(|(_, similarity)| *similarity >= threshold)
        .collect();

    // Sort by similarity (descending)
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Take top results
    scored.truncate(limit);

    Ok(scored)
}

/// Find chunks similar to a given code snippet
pub async fn find_similar_code(
    db: &Database,
    index_id: &str,
    code: &str,
    embedding_provider: &str,
    embedding_model: &str,
    api_key: &str,
    limit: usize,
    threshold: f32,
) -> AppResult<Vec<(crate::db::ChunkMetadata, f32)>> {
    // Get embedding provider
    let provider = embeddings::get_provider(embedding_provider)
        .ok_or_else(|| AppError::Embedding(format!("Unknown provider: {}", embedding_provider)))?;

    // Generate embedding for the query code
    let embeddings = provider.embed_texts(api_key, embedding_model, &[code.to_string()]).await?;

    if embeddings.is_empty() {
        return Ok(Vec::new());
    }

    // Search for similar chunks
    semantic_search(db, index_id, &embeddings[0], limit, threshold)
}

/// Get all usages of an abstraction (class, interface, trait)
pub fn get_abstraction_usages(
    db: &Database,
    index_id: &str,
    name: &str,
    abstraction_type: Option<ChunkType>,
) -> AppResult<Vec<crate::db::ChunkMetadata>> {
    // First, search by name
    let mut results = db.search_chunks_by_name(index_id, name, 100)?;

    // Filter by type if specified
    if let Some(ref chunk_type) = abstraction_type {
        results.retain(|c| &c.chunk_type == chunk_type);
    }

    Ok(results)
}
