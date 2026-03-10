use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::crypto::{decrypt, encrypt};
use crate::error::{AppError, AppResult};

/// Database wrapper with mutex for thread safety
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Create new database connection
    pub fn new() -> AppResult<Self> {
        let db_path = get_database_path()?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("Failed to create db directory: {}", e)))?;
        }

        let conn = Connection::open(&db_path)?;
        // Enable WAL mode for better concurrent read/write performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.initialize()?;
        Ok(db)
    }

    /// Initialize database schema
    fn initialize(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                github_username TEXT NOT NULL,
                github_avatar_url TEXT,
                github_access_token TEXT NOT NULL,
                github_refresh_token TEXT,
                token_expires_at INTEGER,
                refresh_token_expires_at INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- Migration: Add token columns if they don't exist (for existing databases)
            -- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we ignore errors
            "#,
        )?;

        // Run migrations for existing databases (ignore errors if columns already exist)
        let _ = conn.execute(
            "ALTER TABLE users ADD COLUMN github_refresh_token TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE users ADD COLUMN token_expires_at INTEGER",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE users ADD COLUMN refresh_token_expires_at INTEGER",
            [],
        );

        conn.execute_batch(
            r#"

            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                analysis_data TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_comments (
                id TEXT PRIMARY KEY,
                review_id TEXT NOT NULL REFERENCES reviews(id),
                file_path TEXT NOT NULL,
                line_number INTEGER,
                comment_body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                github_comment_id TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_ai_settings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                provider TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model_preference TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, provider)
            );

            CREATE TABLE IF NOT EXISTS favorite_repos (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                repo_id INTEGER NOT NULL,
                repo_full_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, repo_id)
            );

            CREATE TABLE IF NOT EXISTS pr_review_state (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                last_reviewed_commit TEXT NOT NULL,
                viewed_files TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, repo_owner, repo_name, pr_number)
            );

            CREATE TABLE IF NOT EXISTS linked_repos (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                repo_full_name TEXT NOT NULL,
                local_path TEXT NOT NULL,
                last_analyzed_commit TEXT,
                profile_data TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, repo_full_name)
            );

            CREATE TABLE IF NOT EXISTS pr_analyses (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                head_commit TEXT NOT NULL,
                analysis_data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, repo_owner, repo_name, pr_number, head_commit)
            );

            CREATE TABLE IF NOT EXISTS agent_settings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                agent_type TEXT NOT NULL,
                model_override TEXT,
                custom_prompt TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, agent_type)
            );

            CREATE TABLE IF NOT EXISTS agent_mcp_servers (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                agent_type TEXT NOT NULL,
                server_name TEXT NOT NULL,
                server_command TEXT NOT NULL,
                server_args TEXT,
                server_env TEXT,
                transport_type TEXT NOT NULL DEFAULT 'stdio',
                http_url TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, agent_type, server_name)
            );

            CREATE TABLE IF NOT EXISTS user_service_keys (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                service_name TEXT NOT NULL,
                api_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, service_name)
            );

            CREATE TABLE IF NOT EXISTS research_agent_settings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                model_preference TEXT,
                max_iterations INTEGER NOT NULL DEFAULT 10,
                timeout_seconds INTEGER NOT NULL DEFAULT 120,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id)
            );

            -- Semantic codebase indexing tables
            CREATE TABLE IF NOT EXISTS codebase_indexes (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                repo_full_name TEXT NOT NULL,
                local_path TEXT NOT NULL,
                last_indexed_commit TEXT,
                embedding_provider TEXT NOT NULL,
                embedding_model TEXT NOT NULL,
                embedding_dimensions INTEGER NOT NULL,
                total_chunks INTEGER DEFAULT 0,
                index_status TEXT DEFAULT 'pending',
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, repo_full_name)
            );

            CREATE TABLE IF NOT EXISTS chunk_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                index_id TEXT NOT NULL REFERENCES codebase_indexes(id) ON DELETE CASCADE,
                file_path TEXT NOT NULL,
                chunk_type TEXT NOT NULL,
                name TEXT NOT NULL,
                signature TEXT,
                language TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                content TEXT NOT NULL,
                docstring TEXT,
                parent_name TEXT,
                visibility TEXT,
                embedding BLOB NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS draft_comments (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                line_start INTEGER NOT NULL,
                line_end INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_draft_comments_lookup ON draft_comments(user_id, repo_owner, repo_name, pr_number);

            CREATE INDEX IF NOT EXISTS idx_chunk_metadata_index_id ON chunk_metadata(index_id);
            CREATE INDEX IF NOT EXISTS idx_chunk_metadata_name ON chunk_metadata(name);
            CREATE INDEX IF NOT EXISTS idx_chunk_metadata_file_path ON chunk_metadata(file_path);
            "#,
        )?;

        // Migrations for codebase_indexes progress columns
        let _ = conn.execute(
            "ALTER TABLE codebase_indexes ADD COLUMN files_total INTEGER DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE codebase_indexes ADD COLUMN files_processed INTEGER DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE codebase_indexes ADD COLUMN chunks_processed INTEGER DEFAULT 0",
            [],
        );

        Ok(())
    }

    // User operations

    pub fn get_current_user(&self) -> AppResult<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, github_username, github_avatar_url, created_at, updated_at
             FROM users LIMIT 1"
        )?;

        let user = stmt.query_row([], |row| {
            Ok(User {
                id: row.get(0)?,
                github_username: row.get(1)?,
                github_avatar_url: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        }).ok();

        Ok(user)
    }

    pub fn upsert_user(
        &self,
        id: &str,
        username: &str,
        avatar_url: Option<&str>,
        access_token: &str,
        refresh_token: Option<&str>,
        token_expires_at: Option<i64>,
        refresh_token_expires_at: Option<i64>,
    ) -> AppResult<User> {
        let conn = self.conn.lock().unwrap();
        let encrypted_access = encrypt(access_token)?;
        let encrypted_refresh = refresh_token.map(encrypt).transpose()?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO users (id, github_username, github_avatar_url, github_access_token, github_refresh_token, token_expires_at, refresh_token_expires_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
            ON CONFLICT(id) DO UPDATE SET
                github_username = ?2,
                github_avatar_url = ?3,
                github_access_token = ?4,
                github_refresh_token = ?5,
                token_expires_at = ?6,
                refresh_token_expires_at = ?7,
                updated_at = ?8
            "#,
            params![id, username, avatar_url, encrypted_access, encrypted_refresh, token_expires_at, refresh_token_expires_at, now],
        )?;

        Ok(User {
            id: id.to_string(),
            github_username: username.to_string(),
            github_avatar_url: avatar_url.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Get just the access token (for simple API calls)
    pub fn get_github_token(&self, user_id: &str) -> AppResult<String> {
        let conn = self.conn.lock().unwrap();
        let encrypted: String = conn.query_row(
            "SELECT github_access_token FROM users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )?;

        decrypt(&encrypted)
    }

    /// Get full token data including refresh token and expiration
    pub fn get_github_tokens(&self, user_id: &str) -> AppResult<(String, Option<String>, Option<i64>, Option<i64>)> {
        let conn = self.conn.lock().unwrap();
        let row: (String, Option<String>, Option<i64>, Option<i64>) = conn.query_row(
            "SELECT github_access_token, github_refresh_token, token_expires_at, refresh_token_expires_at FROM users WHERE id = ?1",
            params![user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;

        let access_token = decrypt(&row.0)?;
        let refresh_token = row.1.map(|r| decrypt(&r)).transpose()?;
        Ok((access_token, refresh_token, row.2, row.3))
    }

    /// Update tokens after a refresh
    pub fn update_github_tokens(
        &self,
        user_id: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        token_expires_at: Option<i64>,
        refresh_token_expires_at: Option<i64>,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let encrypted_access = encrypt(access_token)?;
        let encrypted_refresh = refresh_token.map(encrypt).transpose()?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            UPDATE users SET
                github_access_token = ?2,
                github_refresh_token = ?3,
                token_expires_at = ?4,
                refresh_token_expires_at = ?5,
                updated_at = ?6
            WHERE id = ?1
            "#,
            params![user_id, encrypted_access, encrypted_refresh, token_expires_at, refresh_token_expires_at, now],
        )?;

        Ok(())
    }

    pub fn delete_user(&self, user_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        // Delete from all tables that reference users(id)
        conn.execute("DELETE FROM favorite_repos WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM user_ai_settings WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM pr_review_state WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM linked_repos WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM pr_analyses WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM agent_settings WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM agent_mcp_servers WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM user_service_keys WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM research_agent_settings WHERE user_id = ?1", params![user_id])?;
        // Delete codebase indexes (chunks are deleted by CASCADE)
        conn.execute("DELETE FROM codebase_indexes WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM review_comments WHERE review_id IN (SELECT id FROM reviews WHERE user_id = ?1)", params![user_id])?;
        conn.execute("DELETE FROM reviews WHERE user_id = ?1", params![user_id])?;
        // Finally delete the user
        conn.execute("DELETE FROM users WHERE id = ?1", params![user_id])?;
        Ok(())
    }

    // AI Settings operations

    pub fn get_ai_settings(&self, user_id: &str) -> AppResult<Vec<AISettings>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, provider, model_preference, is_active, created_at, updated_at
             FROM user_ai_settings WHERE user_id = ?1"
        )?;

        let settings = stmt.query_map(params![user_id], |row| {
            Ok(AISettings {
                id: row.get(0)?,
                user_id: row.get(1)?,
                provider: row.get(2)?,
                model_preference: row.get(3)?,
                is_active: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(settings)
    }

    pub fn add_ai_settings(&self, user_id: &str, provider: &str, api_key: &str, model: &str) -> AppResult<AISettings> {
        let conn = self.conn.lock().unwrap();
        // Trim whitespace from API key to avoid authentication issues
        let encrypted_key = encrypt(api_key.trim())?;
        let now = Utc::now().to_rfc3339();

        // Check if provider already exists for this user
        let existing: Option<(String, bool, String)> = conn.query_row(
            "SELECT id, is_active, created_at FROM user_ai_settings WHERE user_id = ?1 AND provider = ?2",
            params![user_id, provider],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional()?;

        if let Some((existing_id, is_active, created_at)) = existing {
            // Update existing provider entry with new model and API key
            conn.execute(
                r#"
                UPDATE user_ai_settings
                SET api_key = ?1, model_preference = ?2, updated_at = ?3
                WHERE id = ?4
                "#,
                params![encrypted_key, model, now, existing_id],
            )?;

            Ok(AISettings {
                id: existing_id,
                user_id: user_id.to_string(),
                provider: provider.to_string(),
                model_preference: model.to_string(),
                is_active,
                created_at,
                updated_at: now,
            })
        } else {
            // Insert new provider entry
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                r#"
                INSERT INTO user_ai_settings (id, user_id, provider, api_key, model_preference, is_active, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
                "#,
                params![id, user_id, provider, encrypted_key, model, now],
            )?;

            Ok(AISettings {
                id,
                user_id: user_id.to_string(),
                provider: provider.to_string(),
                model_preference: model.to_string(),
                is_active: false,
                created_at: now.clone(),
                updated_at: now,
            })
        }
    }

    pub fn activate_ai_setting(&self, user_id: &str, setting_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        // Deactivate all
        conn.execute(
            "UPDATE user_ai_settings SET is_active = 0, updated_at = ?1 WHERE user_id = ?2",
            params![now, user_id],
        )?;

        // Activate selected
        conn.execute(
            "UPDATE user_ai_settings SET is_active = 1, updated_at = ?1 WHERE id = ?2 AND user_id = ?3",
            params![now, setting_id, user_id],
        )?;

        Ok(())
    }

    pub fn delete_ai_setting(&self, user_id: &str, setting_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM user_ai_settings WHERE id = ?1 AND user_id = ?2",
            params![setting_id, user_id],
        )?;
        Ok(())
    }

    pub fn get_active_ai_setting(&self, user_id: &str) -> AppResult<Option<(AISettings, String)>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, user_id, provider, api_key, model_preference, is_active, created_at, updated_at
             FROM user_ai_settings WHERE user_id = ?1 AND is_active = 1",
            params![user_id],
            |row| {
                let encrypted_key: String = row.get(3)?;
                Ok((
                    AISettings {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        provider: row.get(2)?,
                        model_preference: row.get(4)?,
                        is_active: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    },
                    encrypted_key,
                ))
            },
        ).ok();

        if let Some((settings, encrypted_key)) = result {
            let api_key = decrypt(&encrypted_key)?;
            Ok(Some((settings, api_key)))
        } else {
            Ok(None)
        }
    }

    /// Find the best configured provider that supports embeddings.
    /// Preference order: openai > google > voyage/anthropic.
    /// Falls back to the active provider if none of the preferred ones are configured.
    pub fn get_embedding_provider(&self, user_id: &str) -> AppResult<Option<(String, String)>> {
        let conn = self.conn.lock().unwrap();

        // Providers that support embeddings, in preference order
        let embedding_providers = ["openai", "google"];

        for provider in &embedding_providers {
            let result: Option<String> = conn.query_row(
                "SELECT api_key FROM user_ai_settings WHERE user_id = ?1 AND provider = ?2",
                params![user_id, provider],
                |row| row.get(0),
            ).optional()?;

            if let Some(encrypted_key) = result {
                let api_key = decrypt(&encrypted_key)?;
                return Ok(Some((provider.to_string(), api_key)));
            }
        }

        Ok(None)
    }

    pub fn get_ai_setting_api_key(&self, setting_id: &str) -> AppResult<String> {
        let conn = self.conn.lock().unwrap();
        let encrypted_key: String = conn.query_row(
            "SELECT api_key FROM user_ai_settings WHERE id = ?1",
            params![setting_id],
            |row| row.get(0),
        ).map_err(|_| AppError::NotFound("AI setting not found".to_string()))?;

        let api_key = decrypt(&encrypted_key)?;
        Ok(api_key)
    }

    // Favorite repos operations

    pub fn get_favorite_repos(&self, user_id: &str) -> AppResult<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT repo_id FROM favorite_repos WHERE user_id = ?1"
        )?;

        let repo_ids = stmt.query_map(params![user_id], |row| {
            row.get(0)
        })?.collect::<Result<Vec<i64>, _>>()?;

        Ok(repo_ids)
    }

    pub fn add_favorite_repo(&self, user_id: &str, repo_id: i64, repo_full_name: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT OR IGNORE INTO favorite_repos (id, user_id, repo_id, repo_full_name, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![id, user_id, repo_id, repo_full_name, now],
        )?;

        Ok(())
    }

    pub fn remove_favorite_repo(&self, user_id: &str, repo_id: i64) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM favorite_repos WHERE user_id = ?1 AND repo_id = ?2",
            params![user_id, repo_id],
        )?;
        Ok(())
    }

    // PR Review State operations

    pub fn get_pr_review_state(
        &self,
        user_id: &str,
        repo_owner: &str,
        repo_name: &str,
        pr_number: i64,
    ) -> AppResult<Option<PRReviewState>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, user_id, repo_owner, repo_name, pr_number, last_reviewed_commit, viewed_files, created_at, updated_at
             FROM pr_review_state
             WHERE user_id = ?1 AND repo_owner = ?2 AND repo_name = ?3 AND pr_number = ?4",
            params![user_id, repo_owner, repo_name, pr_number],
            |row| {
                let viewed_files_json: String = row.get(6)?;
                let viewed_files: Vec<String> = serde_json::from_str(&viewed_files_json).unwrap_or_default();
                Ok(PRReviewState {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    repo_owner: row.get(2)?,
                    repo_name: row.get(3)?,
                    pr_number: row.get(4)?,
                    last_reviewed_commit: row.get(5)?,
                    viewed_files,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        ).ok();

        Ok(result)
    }

    pub fn save_pr_review_state(
        &self,
        user_id: &str,
        repo_owner: &str,
        repo_name: &str,
        pr_number: i64,
        commit_sha: &str,
        viewed_files: &[String],
    ) -> AppResult<PRReviewState> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let viewed_files_json = serde_json::to_string(viewed_files)
            .map_err(|e| AppError::Internal(format!("Failed to serialize viewed files: {}", e)))?;

        conn.execute(
            r#"
            INSERT INTO pr_review_state (id, user_id, repo_owner, repo_name, pr_number, last_reviewed_commit, viewed_files, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
            ON CONFLICT(user_id, repo_owner, repo_name, pr_number) DO UPDATE SET
                last_reviewed_commit = ?6,
                viewed_files = ?7,
                updated_at = ?8
            "#,
            params![id, user_id, repo_owner, repo_name, pr_number, commit_sha, viewed_files_json, now],
        )?;

        Ok(PRReviewState {
            id,
            user_id: user_id.to_string(),
            repo_owner: repo_owner.to_string(),
            repo_name: repo_name.to_string(),
            pr_number,
            last_reviewed_commit: commit_sha.to_string(),
            viewed_files: viewed_files.to_vec(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    // Linked Repos operations

    pub fn get_linked_repos(&self, user_id: &str) -> AppResult<Vec<LinkedRepo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, repo_full_name, local_path, last_analyzed_commit, profile_data, created_at, updated_at
             FROM linked_repos WHERE user_id = ?1"
        )?;

        let repos = stmt.query_map(params![user_id], |row| {
            let profile_json: Option<String> = row.get(5)?;
            let profile_data = profile_json.and_then(|json| serde_json::from_str(&json).ok());
            Ok(LinkedRepo {
                id: row.get(0)?,
                user_id: row.get(1)?,
                repo_full_name: row.get(2)?,
                local_path: row.get(3)?,
                last_analyzed_commit: row.get(4)?,
                profile_data,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(repos)
    }

    pub fn get_linked_repo(&self, user_id: &str, repo_full_name: &str) -> AppResult<Option<LinkedRepo>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, user_id, repo_full_name, local_path, last_analyzed_commit, profile_data, created_at, updated_at
             FROM linked_repos WHERE user_id = ?1 AND repo_full_name = ?2",
            params![user_id, repo_full_name],
            |row| {
                let profile_json: Option<String> = row.get(5)?;
                let profile_data = profile_json.and_then(|json| serde_json::from_str(&json).ok());
                Ok(LinkedRepo {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    repo_full_name: row.get(2)?,
                    local_path: row.get(3)?,
                    last_analyzed_commit: row.get(4)?,
                    profile_data,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        ).ok();

        Ok(result)
    }

    pub fn link_repo(&self, user_id: &str, repo_full_name: &str, local_path: &str) -> AppResult<LinkedRepo> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO linked_repos (id, user_id, repo_full_name, local_path, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                local_path = ?4,
                updated_at = ?5
            "#,
            params![id, user_id, repo_full_name, local_path, now],
        )?;

        Ok(LinkedRepo {
            id,
            user_id: user_id.to_string(),
            repo_full_name: repo_full_name.to_string(),
            local_path: local_path.to_string(),
            last_analyzed_commit: None,
            profile_data: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_repo_profile(
        &self,
        user_id: &str,
        repo_full_name: &str,
        commit_sha: &str,
        profile: &CodebaseProfile,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let profile_json = serde_json::to_string(profile)
            .map_err(|e| AppError::Internal(format!("Failed to serialize profile: {}", e)))?;

        conn.execute(
            r#"
            UPDATE linked_repos
            SET last_analyzed_commit = ?1, profile_data = ?2, updated_at = ?3
            WHERE user_id = ?4 AND repo_full_name = ?5
            "#,
            params![commit_sha, profile_json, now, user_id, repo_full_name],
        )?;

        Ok(())
    }

    pub fn unlink_repo(&self, user_id: &str, repo_full_name: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM linked_repos WHERE user_id = ?1 AND repo_full_name = ?2",
            params![user_id, repo_full_name],
        )?;
        Ok(())
    }

    // PR Analysis operations

    pub fn get_pr_analysis(
        &self,
        user_id: &str,
        repo_owner: &str,
        repo_name: &str,
        pr_number: i64,
        head_commit: &str,
    ) -> AppResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT analysis_data FROM pr_analyses
             WHERE user_id = ?1 AND repo_owner = ?2 AND repo_name = ?3 AND pr_number = ?4 AND head_commit = ?5",
            params![user_id, repo_owner, repo_name, pr_number, head_commit],
            |row| row.get(0),
        ).ok();

        Ok(result)
    }

    pub fn save_pr_analysis(
        &self,
        user_id: &str,
        repo_owner: &str,
        repo_name: &str,
        pr_number: i64,
        head_commit: &str,
        analysis_data: &str,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO pr_analyses (id, user_id, repo_owner, repo_name, pr_number, head_commit, analysis_data, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(user_id, repo_owner, repo_name, pr_number, head_commit) DO UPDATE SET
                analysis_data = ?7
            "#,
            params![id, user_id, repo_owner, repo_name, pr_number, head_commit, analysis_data, now],
        )?;

        Ok(())
    }

    // Agent settings operations

    pub fn get_agent_settings(&self, user_id: &str) -> AppResult<Vec<AgentSettings>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, agent_type, model_override, custom_prompt, enabled, created_at, updated_at
             FROM agent_settings WHERE user_id = ?1"
        )?;

        let settings = stmt.query_map(params![user_id], |row| {
            Ok(AgentSettings {
                id: row.get(0)?,
                user_id: row.get(1)?,
                agent_type: row.get(2)?,
                model_override: row.get(3)?,
                custom_prompt: row.get(4)?,
                enabled: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(settings)
    }

    pub fn get_agent_setting(&self, user_id: &str, agent_type: &str) -> AppResult<Option<AgentSettings>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, user_id, agent_type, model_override, custom_prompt, enabled, created_at, updated_at
             FROM agent_settings WHERE user_id = ?1 AND agent_type = ?2",
            params![user_id, agent_type],
            |row| {
                Ok(AgentSettings {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    agent_type: row.get(2)?,
                    model_override: row.get(3)?,
                    custom_prompt: row.get(4)?,
                    enabled: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        ).ok();

        Ok(result)
    }

    pub fn save_agent_setting(
        &self,
        user_id: &str,
        agent_type: &str,
        model_override: Option<&str>,
        custom_prompt: Option<&str>,
        enabled: bool,
    ) -> AppResult<AgentSettings> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO agent_settings (id, user_id, agent_type, model_override, custom_prompt, enabled, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
            ON CONFLICT(user_id, agent_type) DO UPDATE SET
                model_override = ?4,
                custom_prompt = ?5,
                enabled = ?6,
                updated_at = ?7
            "#,
            params![id, user_id, agent_type, model_override, custom_prompt, enabled, now],
        )?;

        Ok(AgentSettings {
            id,
            user_id: user_id.to_string(),
            agent_type: agent_type.to_string(),
            model_override: model_override.map(|s| s.to_string()),
            custom_prompt: custom_prompt.map(|s| s.to_string()),
            enabled,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    // MCP Server operations

    pub fn get_mcp_servers(&self, user_id: &str, agent_type: &str) -> AppResult<Vec<MCPServerConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, agent_type, server_name, server_command, server_args, server_env, transport_type, http_url, enabled, created_at, updated_at
             FROM agent_mcp_servers WHERE user_id = ?1 AND agent_type = ?2"
        )?;

        let servers = stmt.query_map(params![user_id, agent_type], |row| {
            let args_json: Option<String> = row.get(5)?;
            let env_json: Option<String> = row.get(6)?;
            Ok(MCPServerConfig {
                id: row.get(0)?,
                user_id: row.get(1)?,
                agent_type: row.get(2)?,
                server_name: row.get(3)?,
                server_command: row.get(4)?,
                server_args: args_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                server_env: env_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                transport_type: row.get(7)?,
                http_url: row.get(8)?,
                enabled: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(servers)
    }

    pub fn get_all_mcp_servers(&self, user_id: &str) -> AppResult<Vec<MCPServerConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, agent_type, server_name, server_command, server_args, server_env, transport_type, http_url, enabled, created_at, updated_at
             FROM agent_mcp_servers WHERE user_id = ?1"
        )?;

        let servers = stmt.query_map(params![user_id], |row| {
            let args_json: Option<String> = row.get(5)?;
            let env_json: Option<String> = row.get(6)?;
            Ok(MCPServerConfig {
                id: row.get(0)?,
                user_id: row.get(1)?,
                agent_type: row.get(2)?,
                server_name: row.get(3)?,
                server_command: row.get(4)?,
                server_args: args_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                server_env: env_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                transport_type: row.get(7)?,
                http_url: row.get(8)?,
                enabled: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(servers)
    }

    pub fn add_mcp_server(
        &self,
        user_id: &str,
        agent_type: &str,
        server_name: &str,
        server_command: &str,
        server_args: &[String],
        server_env: &std::collections::HashMap<String, String>,
        transport_type: &str,
        http_url: Option<&str>,
    ) -> AppResult<MCPServerConfig> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let args_json = serde_json::to_string(server_args)
            .map_err(|e| AppError::Internal(format!("Failed to serialize args: {}", e)))?;
        let env_json = serde_json::to_string(server_env)
            .map_err(|e| AppError::Internal(format!("Failed to serialize env: {}", e)))?;

        conn.execute(
            r#"
            INSERT INTO agent_mcp_servers (id, user_id, agent_type, server_name, server_command, server_args, server_env, transport_type, http_url, enabled, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10)
            "#,
            params![id, user_id, agent_type, server_name, server_command, args_json, env_json, transport_type, http_url, now],
        )?;

        Ok(MCPServerConfig {
            id,
            user_id: user_id.to_string(),
            agent_type: agent_type.to_string(),
            server_name: server_name.to_string(),
            server_command: server_command.to_string(),
            server_args: server_args.to_vec(),
            server_env: server_env.clone(),
            transport_type: transport_type.to_string(),
            http_url: http_url.map(|s| s.to_string()),
            enabled: true,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn delete_mcp_server(&self, user_id: &str, agent_type: &str, server_name: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM agent_mcp_servers WHERE user_id = ?1 AND agent_type = ?2 AND server_name = ?3",
            params![user_id, agent_type, server_name],
        )?;
        Ok(())
    }

    // Service Keys operations

    pub fn get_service_keys(&self, user_id: &str) -> AppResult<Vec<ServiceKeyInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, service_name, created_at, updated_at
             FROM user_service_keys WHERE user_id = ?1"
        )?;

        let keys = stmt.query_map(params![user_id], |row| {
            Ok(ServiceKeyInfo {
                id: row.get(0)?,
                user_id: row.get(1)?,
                service_name: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(keys)
    }

    pub fn get_service_key(&self, user_id: &str, service_name: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT api_key FROM user_service_keys WHERE user_id = ?1 AND service_name = ?2",
            params![user_id, service_name],
            |row| row.get::<_, String>(0),
        ).ok();

        if let Some(encrypted_key) = result {
            let api_key = decrypt(&encrypted_key)?;
            Ok(Some(api_key))
        } else {
            Ok(None)
        }
    }

    pub fn set_service_key(&self, user_id: &str, service_name: &str, api_key: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let encrypted_key = encrypt(api_key.trim())?;

        conn.execute(
            r#"
            INSERT INTO user_service_keys (id, user_id, service_name, api_key, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            ON CONFLICT(user_id, service_name) DO UPDATE SET
                api_key = ?4,
                updated_at = ?5
            "#,
            params![id, user_id, service_name, encrypted_key, now],
        )?;

        Ok(())
    }

    pub fn delete_service_key(&self, user_id: &str, service_name: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM user_service_keys WHERE user_id = ?1 AND service_name = ?2",
            params![user_id, service_name],
        )?;
        Ok(())
    }

    // Research Agent Settings operations

    pub fn get_research_agent_settings(&self, user_id: &str) -> AppResult<Option<ResearchAgentSettings>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, user_id, model_preference, max_iterations, timeout_seconds, created_at, updated_at
             FROM research_agent_settings WHERE user_id = ?1",
            params![user_id],
            |row| {
                Ok(ResearchAgentSettings {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    model_preference: row.get(2)?,
                    max_iterations: row.get(3)?,
                    timeout_seconds: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        ).ok();

        Ok(result)
    }

    pub fn save_research_agent_settings(
        &self,
        user_id: &str,
        model_preference: Option<&str>,
        max_iterations: u32,
        timeout_seconds: u32,
    ) -> AppResult<ResearchAgentSettings> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO research_agent_settings (id, user_id, model_preference, max_iterations, timeout_seconds, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ON CONFLICT(user_id) DO UPDATE SET
                model_preference = ?3,
                max_iterations = ?4,
                timeout_seconds = ?5,
                updated_at = ?6
            "#,
            params![id, user_id, model_preference, max_iterations, timeout_seconds, now],
        )?;

        Ok(ResearchAgentSettings {
            id,
            user_id: user_id.to_string(),
            model_preference: model_preference.map(|s| s.to_string()),
            max_iterations,
            timeout_seconds,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    // Codebase Index operations

    pub fn create_codebase_index(
        &self,
        user_id: &str,
        repo_full_name: &str,
        local_path: &str,
        embedding_provider: &str,
        embedding_model: &str,
        embedding_dimensions: u32,
    ) -> AppResult<CodebaseIndex> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO codebase_indexes (id, user_id, repo_full_name, local_path, embedding_provider, embedding_model, embedding_dimensions, index_status, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?8)
            ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                local_path = ?4,
                embedding_provider = ?5,
                embedding_model = ?6,
                embedding_dimensions = ?7,
                index_status = 'pending',
                error_message = NULL,
                updated_at = ?8
            "#,
            params![id, user_id, repo_full_name, local_path, embedding_provider, embedding_model, embedding_dimensions, now],
        )?;

        // Get the actual ID (might be existing one on conflict)
        let actual_id: String = conn.query_row(
            "SELECT id FROM codebase_indexes WHERE user_id = ?1 AND repo_full_name = ?2",
            params![user_id, repo_full_name],
            |row| row.get(0),
        )?;

        Ok(CodebaseIndex {
            id: actual_id,
            user_id: user_id.to_string(),
            repo_full_name: repo_full_name.to_string(),
            local_path: local_path.to_string(),
            last_indexed_commit: None,
            embedding_provider: embedding_provider.to_string(),
            embedding_model: embedding_model.to_string(),
            embedding_dimensions,
            total_chunks: 0,
            index_status: IndexStatus::Pending,
            error_message: None,
            files_total: 0,
            files_processed: 0,
            chunks_processed: 0,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_codebase_index(&self, user_id: &str, repo_full_name: &str) -> AppResult<Option<CodebaseIndex>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, user_id, repo_full_name, local_path, last_indexed_commit, embedding_provider, embedding_model, embedding_dimensions, total_chunks, index_status, error_message, created_at, updated_at, COALESCE(files_total, 0), COALESCE(files_processed, 0), COALESCE(chunks_processed, 0)
             FROM codebase_indexes WHERE user_id = ?1 AND repo_full_name = ?2",
            params![user_id, repo_full_name],
            |row| {
                let status_str: String = row.get(9)?;
                Ok(CodebaseIndex {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    repo_full_name: row.get(2)?,
                    local_path: row.get(3)?,
                    last_indexed_commit: row.get(4)?,
                    embedding_provider: row.get(5)?,
                    embedding_model: row.get(6)?,
                    embedding_dimensions: row.get(7)?,
                    total_chunks: row.get(8)?,
                    index_status: IndexStatus::from_str(&status_str),
                    error_message: row.get(10)?,
                    files_total: row.get(13)?,
                    files_processed: row.get(14)?,
                    chunks_processed: row.get(15)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        ).ok();

        Ok(result)
    }

    pub fn update_index_status(&self, index_id: &str, status: IndexStatus, error_message: Option<&str>) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE codebase_indexes SET index_status = ?1, error_message = ?2, updated_at = ?3 WHERE id = ?4",
            params![status.as_str(), error_message, now, index_id],
        )?;

        Ok(())
    }

    pub fn update_index_complete(&self, index_id: &str, commit_sha: &str, total_chunks: u32) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE codebase_indexes SET index_status = 'complete', last_indexed_commit = ?1, total_chunks = ?2, error_message = NULL, updated_at = ?3 WHERE id = ?4",
            params![commit_sha, total_chunks, now, index_id],
        )?;

        Ok(())
    }

    pub fn update_index_progress(&self, index_id: &str, files_total: u32, files_processed: u32, chunks_processed: u32) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE codebase_indexes SET files_total = ?1, files_processed = ?2, chunks_processed = ?3, updated_at = ?4 WHERE id = ?5",
            params![files_total, files_processed, chunks_processed, now, index_id],
        )?;

        Ok(())
    }

    pub fn delete_codebase_index(&self, user_id: &str, repo_full_name: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        // Chunks are deleted by CASCADE
        conn.execute(
            "DELETE FROM codebase_indexes WHERE user_id = ?1 AND repo_full_name = ?2",
            params![user_id, repo_full_name],
        )?;
        Ok(())
    }

    // Chunk operations

    pub fn clear_chunks_for_index(&self, index_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chunk_metadata WHERE index_id = ?1", params![index_id])?;
        Ok(())
    }

    pub fn insert_chunk(
        &self,
        index_id: &str,
        file_path: &str,
        chunk_type: &ChunkType,
        name: &str,
        signature: Option<&str>,
        language: &str,
        start_line: u32,
        end_line: u32,
        content: &str,
        docstring: Option<&str>,
        parent_name: Option<&str>,
        visibility: Option<&str>,
        embedding: &[f32],
    ) -> AppResult<i64> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        // Convert f32 slice to bytes for BLOB storage
        let embedding_bytes: Vec<u8> = embedding.iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        conn.execute(
            r#"
            INSERT INTO chunk_metadata (index_id, file_path, chunk_type, name, signature, language, start_line, end_line, content, docstring, parent_name, visibility, embedding, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
            params![
                index_id, file_path, chunk_type.as_str(), name, signature, language,
                start_line, end_line, content, docstring, parent_name, visibility,
                embedding_bytes, now
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn get_all_chunks_for_index(&self, index_id: &str) -> AppResult<Vec<(ChunkMetadata, Vec<f32>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, index_id, file_path, chunk_type, name, signature, language, start_line, end_line, content, docstring, parent_name, visibility, embedding, created_at
             FROM chunk_metadata WHERE index_id = ?1"
        )?;

        let chunks = stmt.query_map(params![index_id], |row| {
            let chunk_type_str: String = row.get(3)?;
            let embedding_bytes: Vec<u8> = row.get(13)?;

            // Convert bytes back to f32 slice
            let embedding: Vec<f32> = embedding_bytes
                .chunks_exact(4)
                .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect();

            Ok((
                ChunkMetadata {
                    id: row.get(0)?,
                    index_id: row.get(1)?,
                    file_path: row.get(2)?,
                    chunk_type: ChunkType::from_str(&chunk_type_str),
                    name: row.get(4)?,
                    signature: row.get(5)?,
                    language: row.get(6)?,
                    start_line: row.get(7)?,
                    end_line: row.get(8)?,
                    content: row.get(9)?,
                    docstring: row.get(10)?,
                    parent_name: row.get(11)?,
                    visibility: row.get(12)?,
                    created_at: row.get(14)?,
                },
                embedding,
            ))
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(chunks)
    }

    pub fn get_chunk_by_id(&self, chunk_id: i64) -> AppResult<Option<ChunkMetadata>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, index_id, file_path, chunk_type, name, signature, language, start_line, end_line, content, docstring, parent_name, visibility, created_at
             FROM chunk_metadata WHERE id = ?1",
            params![chunk_id],
            |row| {
                let chunk_type_str: String = row.get(3)?;
                Ok(ChunkMetadata {
                    id: row.get(0)?,
                    index_id: row.get(1)?,
                    file_path: row.get(2)?,
                    chunk_type: ChunkType::from_str(&chunk_type_str),
                    name: row.get(4)?,
                    signature: row.get(5)?,
                    language: row.get(6)?,
                    start_line: row.get(7)?,
                    end_line: row.get(8)?,
                    content: row.get(9)?,
                    docstring: row.get(10)?,
                    parent_name: row.get(11)?,
                    visibility: row.get(12)?,
                    created_at: row.get(13)?,
                })
            },
        ).ok();

        Ok(result)
    }

    pub fn search_chunks_by_name(&self, index_id: &str, query: &str, limit: u32) -> AppResult<Vec<ChunkMetadata>> {
        let conn = self.conn.lock().unwrap();
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, index_id, file_path, chunk_type, name, signature, language, start_line, end_line, content, docstring, parent_name, visibility, created_at
             FROM chunk_metadata WHERE index_id = ?1 AND (name LIKE ?2 OR content LIKE ?2)
             LIMIT ?3"
        )?;

        let chunks = stmt.query_map(params![index_id, pattern, limit], |row| {
            let chunk_type_str: String = row.get(3)?;
            Ok(ChunkMetadata {
                id: row.get(0)?,
                index_id: row.get(1)?,
                file_path: row.get(2)?,
                chunk_type: ChunkType::from_str(&chunk_type_str),
                name: row.get(4)?,
                signature: row.get(5)?,
                language: row.get(6)?,
                start_line: row.get(7)?,
                end_line: row.get(8)?,
                content: row.get(9)?,
                docstring: row.get(10)?,
                parent_name: row.get(11)?,
                visibility: row.get(12)?,
                created_at: row.get(13)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(chunks)
    }

    // Draft comment operations

    pub fn save_draft_comment(
        &self,
        user_id: &str,
        owner: &str,
        repo: &str,
        pr_number: i64,
        file_path: &str,
        line_start: i64,
        line_end: i64,
        body: &str,
    ) -> AppResult<DraftComment> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO draft_comments (id, user_id, repo_owner, repo_name, pr_number, file_path, line_start, line_end, body, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
            "#,
            params![id, user_id, owner, repo, pr_number, file_path, line_start, line_end, body, now],
        )?;

        Ok(DraftComment {
            id,
            user_id: user_id.to_string(),
            repo_owner: owner.to_string(),
            repo_name: repo.to_string(),
            pr_number,
            file_path: file_path.to_string(),
            line_start,
            line_end,
            body: body.to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_draft_comments(
        &self,
        user_id: &str,
        owner: &str,
        repo: &str,
        pr_number: i64,
    ) -> AppResult<Vec<DraftComment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, repo_owner, repo_name, pr_number, file_path, line_start, line_end, body, created_at, updated_at
             FROM draft_comments WHERE user_id = ?1 AND repo_owner = ?2 AND repo_name = ?3 AND pr_number = ?4
             ORDER BY created_at ASC"
        )?;

        let comments = stmt.query_map(params![user_id, owner, repo, pr_number], |row| {
            Ok(DraftComment {
                id: row.get(0)?,
                user_id: row.get(1)?,
                repo_owner: row.get(2)?,
                repo_name: row.get(3)?,
                pr_number: row.get(4)?,
                file_path: row.get(5)?,
                line_start: row.get(6)?,
                line_end: row.get(7)?,
                body: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(comments)
    }

    pub fn update_draft_comment(&self, id: &str, body: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE draft_comments SET body = ?1, updated_at = ?2 WHERE id = ?3",
            params![body, now, id],
        )?;

        Ok(())
    }

    pub fn delete_draft_comment(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM draft_comments WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_draft_comments(
        &self,
        user_id: &str,
        owner: &str,
        repo: &str,
        pr_number: i64,
    ) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM draft_comments WHERE user_id = ?1 AND repo_owner = ?2 AND repo_name = ?3 AND pr_number = ?4",
            params![user_id, owner, repo, pr_number],
        )?;
        Ok(())
    }
}

fn get_database_path() -> AppResult<PathBuf> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| AppError::Internal("Could not find data directory".to_string()))?;
    Ok(data_dir.join("SiftPR").join("siftpr.db"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub github_username: String,
    pub github_avatar_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISettings {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub model_preference: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRReviewState {
    pub id: String,
    pub user_id: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub pr_number: i64,
    pub last_reviewed_commit: String,
    pub viewed_files: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftComment {
    pub id: String,
    pub user_id: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub pr_number: i64,
    pub file_path: String,
    pub line_start: i64,
    pub line_end: i64,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedRepo {
    pub id: String,
    pub user_id: String,
    pub repo_full_name: String,
    pub local_path: String,
    pub last_analyzed_commit: Option<String>,
    pub profile_data: Option<CodebaseProfile>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebaseProfile {
    pub directory_structure: Vec<String>,
    pub file_count: u32,
    pub language_breakdown: std::collections::HashMap<String, u32>,
    pub config_files: Vec<ConfigFile>,
    pub patterns: CodebasePatterns,
    pub style_summary: StyleSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebasePatterns {
    pub naming_convention: String,
    pub file_organization: String,
    pub common_abstractions: Vec<String>,
    pub import_style: String,
    pub error_handling_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleSummary {
    pub indentation: String,
    pub quote_style: String,
    pub trailing_commas: bool,
    pub documentation_style: String,
    pub typical_file_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    pub id: String,
    pub user_id: String,
    pub agent_type: String,
    pub model_override: Option<String>,
    pub custom_prompt: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPServerConfig {
    pub id: String,
    pub user_id: String,
    pub agent_type: String,
    pub server_name: String,
    pub server_command: String,
    pub server_args: Vec<String>,
    pub server_env: std::collections::HashMap<String, String>,
    pub transport_type: String,
    pub http_url: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceKeyInfo {
    pub id: String,
    pub user_id: String,
    pub service_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchAgentSettings {
    pub id: String,
    pub user_id: String,
    pub model_preference: Option<String>,
    pub max_iterations: u32,
    pub timeout_seconds: u32,
    pub created_at: String,
    pub updated_at: String,
}

// Codebase indexing types

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebaseIndex {
    pub id: String,
    pub user_id: String,
    pub repo_full_name: String,
    pub local_path: String,
    pub last_indexed_commit: Option<String>,
    pub embedding_provider: String,
    pub embedding_model: String,
    pub embedding_dimensions: u32,
    pub total_chunks: u32,
    pub index_status: IndexStatus,
    pub error_message: Option<String>,
    pub files_total: u32,
    pub files_processed: u32,
    pub chunks_processed: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IndexStatus {
    Pending,
    Indexing,
    Complete,
    Failed,
}

impl IndexStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            IndexStatus::Pending => "pending",
            IndexStatus::Indexing => "indexing",
            IndexStatus::Complete => "complete",
            IndexStatus::Failed => "failed",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "indexing" => IndexStatus::Indexing,
            "complete" => IndexStatus::Complete,
            "failed" => IndexStatus::Failed,
            _ => IndexStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMetadata {
    pub id: i64,
    pub index_id: String,
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
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ChunkType {
    Function,
    Method,
    Class,
    Struct,
    Interface,
    Enum,
    Trait,
    Module,
}

impl ChunkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChunkType::Function => "function",
            ChunkType::Method => "method",
            ChunkType::Class => "class",
            ChunkType::Struct => "struct",
            ChunkType::Interface => "interface",
            ChunkType::Enum => "enum",
            ChunkType::Trait => "trait",
            ChunkType::Module => "module",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "function" => ChunkType::Function,
            "method" => ChunkType::Method,
            "class" => ChunkType::Class,
            "struct" => ChunkType::Struct,
            "interface" => ChunkType::Interface,
            "enum" => ChunkType::Enum,
            "trait" => ChunkType::Trait,
            "module" => ChunkType::Module,
            _ => ChunkType::Function,
        }
    }
}
