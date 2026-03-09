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
}

// Make AppError serializable for Tauri commands
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
