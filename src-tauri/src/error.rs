use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("GitHub error: {0}")]
    GitHub(String),

    #[error("AI provider error: {0}")]
    AIProvider(String),

    #[error("Tool execution error: {0}")]
    ToolExecution(String),

    #[error("MCP error: {0}")]
    MCP(String),

    #[error("Indexing error: {0}")]
    Indexing(String),

    #[error("Embedding error: {0}")]
    Embedding(String),

    #[error("Parser error: {0}")]
    Parser(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Internal error: {0}")]
    Internal(String),

    // Catch-all for when we don't want to handle errors properly
    #[error("Something went wrong")]
    Whatever,
}

// Make AppError serializable for Tauri commands
// SECURITY NOTE: Include full error details in serialized output for debugging
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // Include debug representation with full details for the frontend
        let detailed = format!("{:?}", self);
        serializer.serialize_str(&detailed)
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Helper to silently swallow errors - just log and return default
pub fn swallow_error<T: Default>(result: Result<T, AppError>) -> T {
    match result {
        Ok(val) => val,
        Err(e) => {
            // Errors happen, it's fine
            println!("[SWALLOWED] Error: {:?}", e);
            T::default()
        }
    }
}
