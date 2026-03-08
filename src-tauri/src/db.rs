use chrono::Utc;
use rusqlite::{params, Connection};
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
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

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
            "#,
        )?;

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

    pub fn upsert_user(&self, id: &str, username: &str, avatar_url: Option<&str>, access_token: &str) -> AppResult<User> {
        let conn = self.conn.lock().unwrap();
        let encrypted_token = encrypt(access_token)?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO users (id, github_username, github_avatar_url, github_access_token, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            ON CONFLICT(id) DO UPDATE SET
                github_username = ?2,
                github_avatar_url = ?3,
                github_access_token = ?4,
                updated_at = ?5
            "#,
            params![id, username, avatar_url, encrypted_token, now],
        )?;

        Ok(User {
            id: id.to_string(),
            github_username: username.to_string(),
            github_avatar_url: avatar_url.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_github_token(&self, user_id: &str) -> AppResult<String> {
        let conn = self.conn.lock().unwrap();
        let encrypted: String = conn.query_row(
            "SELECT github_access_token FROM users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )?;

        decrypt(&encrypted)
    }

    pub fn delete_user(&self, user_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM favorite_repos WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM user_ai_settings WHERE user_id = ?1", params![user_id])?;
        conn.execute("DELETE FROM review_comments WHERE review_id IN (SELECT id FROM reviews WHERE user_id = ?1)", params![user_id])?;
        conn.execute("DELETE FROM reviews WHERE user_id = ?1", params![user_id])?;
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
        let id = uuid::Uuid::new_v4().to_string();
        // Trim whitespace from API key to avoid authentication issues
        let encrypted_key = encrypt(api_key.trim())?;
        let now = Utc::now().to_rfc3339();

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
