use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

// GitHub OAuth configuration
// In production, these should be loaded from a config file or environment
const GITHUB_CLIENT_ID: &str = "Iv23liC6bORxIX5AC6u1";
const GITHUB_CLIENT_SECRET: &str = "e05ae92c595715c3c3660f19699abcea53158219";

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubUser {
    pub id: i64,
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubPR {
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub user: GitHubPRUser,
    pub base: GitHubBranch,
    pub head: GitHubBranch,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubPRUser {
    pub login: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubBranch {
    #[serde(rename = "ref")]
    pub ref_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubFile {
    pub filename: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub patch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

pub struct GitHubClient {
    client: reqwest::Client,
}

impl GitHubClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    /// Get the OAuth authorization URL
    pub fn get_oauth_url() -> String {
        let params = [
            ("client_id", GITHUB_CLIENT_ID),
            ("redirect_uri", "siftpr://oauth/callback"),
            ("scope", "read:user user:email repo"),
        ];
        let query = serde_urlencoded::to_string(&params).unwrap_or_default();
        format!("https://github.com/login/oauth/authorize?{}", query)
    }

    /// Exchange OAuth code for access token
    pub async fn exchange_code(&self, code: &str) -> AppResult<String> {
        let response = self
            .client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .json(&serde_json::json!({
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code
            }))
            .send()
            .await?;

        let token_data: TokenResponse = response.json().await?;
        Ok(token_data.access_token)
    }

    /// Get the authenticated user's info
    pub async fn get_user(&self, token: &str) -> AppResult<GitHubUser> {
        let response = self
            .client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "ReviewBoss")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to get user: {}",
                response.status()
            )));
        }

        Ok(response.json().await?)
    }

    /// Get pull request details
    pub async fn get_pr(&self, token: &str, owner: &str, repo: &str, pr_number: i64) -> AppResult<GitHubPR> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}",
            owner, repo, pr_number
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "ReviewBoss")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to get PR: {}",
                response.status()
            )));
        }

        Ok(response.json().await?)
    }

    /// Get files changed in a pull request
    pub async fn get_pr_files(&self, token: &str, owner: &str, repo: &str, pr_number: i64) -> AppResult<Vec<GitHubFile>> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/files",
            owner, repo, pr_number
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "ReviewBoss")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to get PR files: {}",
                response.status()
            )));
        }

        Ok(response.json().await?)
    }

    /// Get raw file content
    pub async fn get_file_content(&self, token: &str, owner: &str, repo: &str, path: &str, ref_name: &str) -> AppResult<String> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
            owner, repo, path, ref_name
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github.raw+json")
            .header("User-Agent", "ReviewBoss")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::GitHub(format!(
                "Failed to get file content: {}",
                response.status()
            )));
        }

        Ok(response.text().await?)
    }
}

/// Parse a GitHub PR URL into owner, repo, and PR number
pub fn parse_pr_url(url: &str) -> AppResult<(String, String, i64)> {
    // Expected format: https://github.com/owner/repo/pull/123
    let url = url.trim();

    let parts: Vec<&str> = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("github.com/")
        .split('/')
        .collect();

    if parts.len() < 4 || parts[2] != "pull" {
        return Err(AppError::GitHub(
            "Invalid PR URL. Expected: https://github.com/owner/repo/pull/123".to_string(),
        ));
    }

    let owner = parts[0].to_string();
    let repo = parts[1].to_string();
    let pr_number: i64 = parts[3]
        .parse()
        .map_err(|_| AppError::GitHub("Invalid PR number".to_string()))?;

    Ok((owner, repo, pr_number))
}
