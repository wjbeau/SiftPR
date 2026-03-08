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
        let encrypted_key = encrypt(api_key)?;
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
}

fn get_database_path() -> AppResult<PathBuf> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| AppError::Internal("Could not find data directory".to_string()))?;
    Ok(data_dir.join("ReviewBoss").join("reviewboss.db"))
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
