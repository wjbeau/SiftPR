mod ai;
mod codebase;
mod crypto;
mod db;
mod error;
mod github;
mod indexer;
mod parser;

use std::sync::Mutex;
use tauri::State;

use ai::{AIClient, MCPManager, MCPTool, ModelInfo, OrchestratedAnalysis, Orchestrator, prompts, types::AgentType, orchestrator::{AgentConfig, ToolConfig}, tools::ToolExecutionConfig};
use db::{AISettings, AgentSettings, CodebaseProfile, Database, LinkedRepo, PRReviewState, User};
use error::{AppError, AppResult};
use github::{GitHubClient, GitHubFile, GitHubPR, GitHubRepo, OAuthTokens};

/// Application state - only holds database, clients are created as needed
pub struct AppState {
    pub db: Database,
}

// Auth commands

#[tauri::command]
fn auth_get_oauth_url() -> String {
    GitHubClient::get_oauth_url()
}

#[tauri::command]
async fn auth_exchange_code(
    code: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<User> {
    let client = GitHubClient::new();

    // Exchange code for tokens
    let tokens = client.exchange_code(&code).await?;

    // Get user info
    let github_user = client.get_user(&tokens.access_token).await?;

    // Save to database (lock only for DB operation)
    let user = {
        let app = state.lock().unwrap();
        app.db.upsert_user(
            &github_user.id.to_string(),
            &github_user.login,
            Some(&github_user.avatar_url),
            &tokens.access_token,
            tokens.refresh_token.as_deref(),
            tokens.expires_at,
            tokens.refresh_token_expires_at,
        )?
    };

    Ok(user)
}

/// Helper function to get a valid access token, refreshing if expired
/// Returns (token, user_id) for use in API calls
async fn get_valid_token(state: &State<'_, Mutex<AppState>>) -> AppResult<(String, String)> {
    // Get token info while holding lock briefly
    let (user_id, access_token, refresh_token, expires_at, refresh_expires_at) = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        let (access_token, refresh_token, expires_at, refresh_expires_at) = app.db.get_github_tokens(&user.id)?;
        (user.id, access_token, refresh_token, expires_at, refresh_expires_at)
    };

    // Check if token is expired or about to expire (within 5 minutes)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let buffer_seconds = 300; // 5 minutes buffer

    if let Some(exp) = expires_at {
        if now >= exp - buffer_seconds {
            // Token is expired or expiring soon, try to refresh
            if let Some(ref refresh) = refresh_token {
                // Check if refresh token is still valid
                if let Some(refresh_exp) = refresh_expires_at {
                    if now >= refresh_exp {
                        return Err(AppError::Unauthorized);
                    }
                }

                // Refresh the token (no lock held during async call)
                let client = GitHubClient::new();
                let new_tokens = client.refresh_token(refresh).await?;

                // Update in database (reacquire lock)
                {
                    let app = state.lock().unwrap();
                    app.db.update_github_tokens(
                        &user_id,
                        &new_tokens.access_token,
                        new_tokens.refresh_token.as_deref(),
                        new_tokens.expires_at,
                        new_tokens.refresh_token_expires_at,
                    )?;
                }

                return Ok((new_tokens.access_token, user_id));
            } else {
                // No refresh token and access token expired
                return Err(AppError::Unauthorized);
            }
        }
    }

    // Token is still valid (or non-expiring)
    Ok((access_token, user_id))
}

#[tauri::command]
fn auth_get_user(state: State<'_, Mutex<AppState>>) -> AppResult<Option<User>> {
    let app = state.lock().unwrap();
    app.db.get_current_user()
}

#[tauri::command]
fn auth_logout(state: State<'_, Mutex<AppState>>) -> AppResult<()> {
    let app = state.lock().unwrap();
    if let Some(user) = app.db.get_current_user()? {
        app.db.delete_user(&user.id)?;
    }
    Ok(())
}

// Settings commands

#[tauri::command]
fn settings_get_ai_providers(
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<AISettings>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_ai_settings(&user.id)
}

#[tauri::command]
fn settings_add_ai_provider(
    provider: String,
    api_key: String,
    model: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<AISettings> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;

    // If api_key is empty, look up existing API key for this provider
    let actual_api_key = if api_key.is_empty() {
        let settings = app.db.get_ai_settings(&user.id)?;
        if let Some(existing) = settings.iter().find(|s| s.provider == provider) {
            app.db.get_ai_setting_api_key(&existing.id)?
        } else {
            return Err(AppError::AIProvider(format!("No API key configured for provider: {}", provider)));
        }
    } else {
        api_key
    };

    app.db.add_ai_settings(&user.id, &provider, &actual_api_key, &model)
}

#[tauri::command]
fn settings_activate_ai_provider(
    setting_id: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.activate_ai_setting(&user.id, &setting_id)
}

#[tauri::command]
fn settings_delete_ai_provider(
    setting_id: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.delete_ai_setting(&user.id, &setting_id)
}

#[tauri::command]
async fn settings_fetch_models(
    provider: String,
    api_key_or_url: String,
) -> AppResult<Vec<ModelInfo>> {
    let client = AIClient::new();
    client.fetch_models(&provider, &api_key_or_url).await
}

#[tauri::command]
async fn settings_fetch_models_for_provider(
    provider: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<ModelInfo>> {
    // Get the stored API key for this provider
    let api_key_or_url = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        let settings = app.db.get_ai_settings(&user.id)?;

        // Find the first setting for this provider and get its API key
        let setting = settings.iter().find(|s| s.provider == provider)
            .ok_or_else(|| AppError::AIProvider(format!("Provider {} not configured", provider)))?;

        // Get the decrypted API key
        app.db.get_ai_setting_api_key(&setting.id)?
    };

    let client = AIClient::new();
    client.fetch_models(&provider, &api_key_or_url).await
}

// Favorites commands

#[tauri::command]
fn favorites_get(state: State<'_, Mutex<AppState>>) -> AppResult<Vec<i64>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_favorite_repos(&user.id)
}

#[tauri::command]
fn favorites_add(
    repo_id: i64,
    repo_full_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.add_favorite_repo(&user.id, repo_id, &repo_full_name)
}

#[tauri::command]
fn favorites_remove(repo_id: i64, state: State<'_, Mutex<AppState>>) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.remove_favorite_repo(&user.id, repo_id)
}

// GitHub commands

#[tauri::command]
async fn github_get_repos(
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<GitHubRepo>> {
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.get_repos(&token).await
}

#[tauri::command]
async fn github_get_repo_prs(
    owner: String,
    repo: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<GitHubPR>> {
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.get_repo_prs(&token, &owner, &repo).await
}

#[tauri::command]
async fn github_get_repo_pr_count(
    owner: String,
    repo: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<i64> {
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.get_repo_pr_count(&token, &owner, &repo).await
}

#[tauri::command]
async fn github_get_user_reviewed_prs(
    owner: String,
    repo: String,
    pr_numbers: Vec<i64>,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<i64>> {
    let (token, _) = get_valid_token(&state).await?;
    let username = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        user.github_username
    };

    let client = GitHubClient::new();
    let mut reviewed_prs = Vec::new();

    for pr_number in pr_numbers {
        if client.has_user_interacted(&token, &owner, &repo, pr_number, &username).await? {
            reviewed_prs.push(pr_number);
        }
    }

    Ok(reviewed_prs)
}

#[tauri::command]
async fn github_get_pr(
    url: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<GitHubPR> {
    let (owner, repo, pr_number) = github::parse_pr_url(&url)?;
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.get_pr(&token, &owner, &repo, pr_number).await
}

#[tauri::command]
async fn github_get_pr_files(
    url: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<GitHubFile>> {
    let (owner, repo, pr_number) = github::parse_pr_url(&url)?;
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.get_pr_files(&token, &owner, &repo, pr_number).await
}

// AI commands

#[tauri::command]
async fn ai_analyze_pr(
    url: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<ai::PRAnalysis> {
    let (owner, repo, pr_number) = github::parse_pr_url(&url)?;
    let (token, _) = get_valid_token(&state).await?;

    // Get AI settings from DB (short lock)
    let (provider, api_key, model) = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        let (settings, key) = app.db.get_active_ai_setting(&user.id)?
            .ok_or(AppError::AIProvider("No AI provider configured".to_string()))?;
        (settings.provider, key, settings.model_preference)
    };

    // Get PR details (no lock held)
    let github_client = GitHubClient::new();
    let pr = github_client.get_pr(&token, &owner, &repo, pr_number).await?;
    let files = github_client.get_pr_files(&token, &owner, &repo, pr_number).await?;

    // Analyze with AI (no lock held)
    let ai_client = AIClient::new();
    ai_client.analyze_pr(
        &provider,
        &api_key,
        &model,
        &pr.title,
        pr.body.as_deref(),
        &files,
    ).await
}

#[tauri::command]
async fn ai_analyze_pr_orchestrated(
    url: String,
    with_codebase_context: Option<bool>,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<OrchestratedAnalysis> {
    let (owner, repo, pr_number) = github::parse_pr_url(&url)?;
    let repo_full_name = format!("{}/{}", owner, repo);
    let (token, _) = get_valid_token(&state).await?;

    // Get AI settings, and agent settings from DB (short lock)
    let (provider, api_key, model, codebase_context, agent_configs, user_id, linked_repo_path) = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        let (settings, key) = app.db.get_active_ai_setting(&user.id)?
            .ok_or(AppError::AIProvider("No AI provider configured".to_string()))?;

        // Get linked repo info and codebase context if requested
        let linked = app.db.get_linked_repo(&user.id, &repo_full_name)?;
        let context = if with_codebase_context.unwrap_or(false) {
            linked.as_ref().and_then(|l| {
                l.profile_data.as_ref().map(|profile| {
                    codebase::generate_context_summary(profile)
                })
            })
        } else {
            None
        };
        let linked_path = linked.map(|l| l.local_path);

        // Get agent settings and convert to AgentConfigs
        let agent_settings = app.db.get_agent_settings(&user.id)?;
        let configs: Vec<AgentConfig> = [
            AgentType::Security,
            AgentType::Architecture,
            AgentType::Style,
            AgentType::Performance,
        ].iter().map(|agent_type| {
            let setting = agent_settings.iter().find(|s| s.agent_type == agent_type.as_str());
            AgentConfig {
                agent_type: *agent_type,
                enabled: setting.map(|s| s.enabled).unwrap_or(true),
                model_override: setting.and_then(|s| s.model_override.clone()),
                custom_prompt: setting.and_then(|s| s.custom_prompt.clone()),
                use_tools: linked_path.is_some(), // Enable tools if repo is linked
            }
        }).collect();

        (settings.provider, key, settings.model_preference, context, configs, user.id, linked_path)
    };

    // Get PR details (no lock held)
    let github_client = GitHubClient::new();
    let pr = github_client.get_pr(&token, &owner, &repo, pr_number).await?;
    let files = github_client.get_pr_files(&token, &owner, &repo, pr_number).await?;

    // Build tool config if repo is linked
    let tool_config = linked_repo_path.map(|path| ToolConfig {
        repo_path: Some(path),
        repo_full_name: Some(repo_full_name.clone()),
        user_id: user_id.clone(),
        execution_config: ToolExecutionConfig::default(),
    });

    // Run orchestrated analysis with all agents (no lock held)
    let orchestrator = Orchestrator::new();
    orchestrator.analyze_pr(
        &provider,
        &api_key,
        &model,
        &pr.title,
        pr.body.as_deref(),
        &files,
        codebase_context.as_deref(),
        Some(agent_configs),
        tool_config,
    ).await
}

// Review state commands

#[tauri::command]
fn review_get_state(
    owner: String,
    repo: String,
    pr_number: i64,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Option<PRReviewState>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_pr_review_state(&user.id, &owner, &repo, pr_number)
}

#[tauri::command]
fn review_save_state(
    owner: String,
    repo: String,
    pr_number: i64,
    commit_sha: String,
    viewed_files: Vec<String>,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<PRReviewState> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.save_pr_review_state(&user.id, &owner, &repo, pr_number, &commit_sha, &viewed_files)
}

#[tauri::command]
fn analysis_get(
    owner: String,
    repo: String,
    pr_number: i64,
    head_commit: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Option<OrchestratedAnalysis>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;

    if let Some(json) = app.db.get_pr_analysis(&user.id, &owner, &repo, pr_number, &head_commit)? {
        let analysis: OrchestratedAnalysis = serde_json::from_str(&json)
            .map_err(|e| AppError::Internal(format!("Failed to parse analysis: {}", e)))?;
        Ok(Some(analysis))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn analysis_save(
    owner: String,
    repo: String,
    pr_number: i64,
    head_commit: String,
    analysis: OrchestratedAnalysis,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;

    let json = serde_json::to_string(&analysis)
        .map_err(|e| AppError::Internal(format!("Failed to serialize analysis: {}", e)))?;

    app.db.save_pr_analysis(&user.id, &owner, &repo, pr_number, &head_commit, &json)
}

#[tauri::command]
async fn github_compare_commits(
    owner: String,
    repo: String,
    base: String,
    head: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<GitHubFile>> {
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.compare_commits(&token, &owner, &repo, &base, &head).await
}

#[tauri::command]
async fn github_get_file_content(
    owner: String,
    repo: String,
    path: String,
    ref_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<String> {
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.get_file_content(&token, &owner, &repo, &path, &ref_name).await
}

#[tauri::command]
async fn github_submit_review(
    owner: String,
    repo: String,
    pr_number: i64,
    event: String, // "APPROVE", "REQUEST_CHANGES", or "COMMENT"
    body: String,
    comments: Vec<github::ReviewComment>,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let (token, _) = get_valid_token(&state).await?;
    let client = GitHubClient::new();
    client.submit_review(&token, &owner, &repo, pr_number, &event, &body, comments).await
}

// Linked repos commands

#[tauri::command]
fn codebase_get_linked_repos(
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<LinkedRepo>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_linked_repos(&user.id)
}

#[tauri::command]
fn codebase_get_linked_repo(
    repo_full_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Option<LinkedRepo>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_linked_repo(&user.id, &repo_full_name)
}

#[tauri::command]
fn codebase_link_repo(
    repo_full_name: String,
    local_path: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<LinkedRepo> {
    // Validate the path exists
    let path = std::path::Path::new(&local_path);
    if !path.exists() {
        return Err(AppError::Internal(format!("Path does not exist: {}", local_path)));
    }
    if !path.is_dir() {
        return Err(AppError::Internal(format!("Path is not a directory: {}", local_path)));
    }

    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.link_repo(&user.id, &repo_full_name, &local_path)
}

#[tauri::command]
fn codebase_unlink_repo(
    repo_full_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.unlink_repo(&user.id, &repo_full_name)
}

#[tauri::command]
fn codebase_analyze(
    repo_full_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<CodebaseProfile> {
    let (user_id, local_path) = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        let linked = app.db.get_linked_repo(&user.id, &repo_full_name)?
            .ok_or_else(|| AppError::Internal(format!("Repository not linked: {}", repo_full_name)))?;
        (user.id, linked.local_path)
    };

    // Analyze the repository
    let profile = codebase::analyze_repository(&local_path)?;

    // Get current commit
    let commit_sha = codebase::get_head_commit(&local_path)?;

    // Save the profile
    {
        let app = state.lock().unwrap();
        app.db.update_repo_profile(&user_id, &repo_full_name, &commit_sha, &profile)?;
    }

    Ok(profile)
}

#[tauri::command]
fn codebase_get_context_summary(
    repo_full_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Option<String>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    let linked = app.db.get_linked_repo(&user.id, &repo_full_name)?;

    if let Some(repo) = linked {
        if let Some(profile) = repo.profile_data {
            return Ok(Some(codebase::generate_context_summary(&profile)));
        }
    }

    Ok(None)
}

#[tauri::command]
async fn codebase_clone_repo(
    repo_full_name: String,
    destination_path: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<LinkedRepo> {
    // Get valid token (with refresh if needed)
    let (token, user_id) = get_valid_token(&state).await?;

    // Validate destination path exists
    let dest_path = std::path::Path::new(&destination_path);
    if !dest_path.exists() {
        return Err(AppError::Internal(format!(
            "Destination path does not exist: {}",
            destination_path
        )));
    }
    if !dest_path.is_dir() {
        return Err(AppError::Internal(format!(
            "Destination path is not a directory: {}",
            destination_path
        )));
    }

    // Extract repo name from full name (owner/repo -> repo)
    let repo_name = repo_full_name
        .split('/')
        .last()
        .ok_or_else(|| AppError::Internal("Invalid repository name".to_string()))?;

    // Full path where repo will be cloned
    let clone_path = dest_path.join(repo_name);
    let clone_path_str = clone_path.to_string_lossy().to_string();

    // Check if clone path already exists
    if clone_path.exists() {
        return Err(AppError::Internal(format!(
            "Directory already exists: {}",
            clone_path_str
        )));
    }

    // Build authenticated clone URL
    let clone_url = format!(
        "https://x-access-token:{}@github.com/{}.git",
        token, repo_full_name
    );

    // Run git clone
    let output = std::process::Command::new("git")
        .args(["clone", &clone_url, &clone_path_str])
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to run git clone: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't leak the token in error messages
        let sanitized_error = stderr.replace(&token, "[REDACTED]");
        return Err(AppError::Internal(format!(
            "Git clone failed: {}",
            sanitized_error
        )));
    }

    // Link the cloned repository
    let linked_repo = {
        let app = state.lock().unwrap();
        app.db.link_repo(&user_id, &repo_full_name, &clone_path_str)?
    };

    Ok(linked_repo)
}

// Codebase indexing commands

#[derive(serde::Serialize)]
pub struct IndexStatus {
    pub status: String,
    pub last_indexed_commit: Option<String>,
    pub total_chunks: u32,
    pub error_message: Option<String>,
}

#[tauri::command]
async fn codebase_index_start(
    repo_full_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    // Get user and linked repo info
    let (user_id, local_path, embedding_provider, embedding_model, api_key) = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;

        let linked = app.db.get_linked_repo(&user.id, &repo_full_name)?
            .ok_or_else(|| AppError::Internal(format!("Repository not linked: {}", repo_full_name)))?;

        // Get active AI provider for embeddings
        let (settings, key) = app.db.get_active_ai_setting(&user.id)?
            .ok_or_else(|| AppError::AIProvider("No active AI provider configured".to_string()))?;

        (user.id, linked.local_path, settings.provider, settings.model_preference, key)
    };

    // Determine embedding model based on provider
    let embed_model = match embedding_provider.as_str() {
        "openai" => "text-embedding-3-small",
        "google" => "text-embedding-004",
        "anthropic" | "voyage" => "voyage-code-3",
        _ => "text-embedding-3-small",
    };

    // Run indexing (this is async)
    let db = {
        let app = state.lock().unwrap();
        // Create a new database connection for the async operation
        db::Database::new()?
    };

    indexer::index_repository(
        &db,
        &user_id,
        &repo_full_name,
        &local_path,
        &embedding_provider,
        embed_model,
        &api_key,
    ).await?;

    Ok(())
}

#[tauri::command]
fn codebase_index_status(
    repo_full_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Option<IndexStatus>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;

    let index = app.db.get_codebase_index(&user.id, &repo_full_name)?;

    Ok(index.map(|idx| IndexStatus {
        status: idx.index_status.as_str().to_string(),
        last_indexed_commit: idx.last_indexed_commit,
        total_chunks: idx.total_chunks,
        error_message: idx.error_message,
    }))
}

#[tauri::command]
async fn codebase_semantic_search(
    repo_full_name: String,
    query: String,
    limit: Option<u32>,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<db::ChunkMetadata>> {
    let (index_id, embedding_provider, api_key) = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;

        let index = app.db.get_codebase_index(&user.id, &repo_full_name)?
            .ok_or_else(|| AppError::NotFound("Repository not indexed".to_string()))?;

        if index.index_status != db::IndexStatus::Complete {
            return Err(AppError::Indexing("Index is not complete".to_string()));
        }

        let (settings, key) = app.db.get_active_ai_setting(&user.id)?
            .ok_or_else(|| AppError::AIProvider("No active AI provider configured".to_string()))?;

        (index.id, settings.provider, key)
    };

    // Get embedding provider
    let provider = ai::embeddings::get_provider(&embedding_provider)
        .ok_or_else(|| AppError::Embedding(format!("Unknown provider: {}", embedding_provider)))?;

    // Determine embedding model
    let embed_model = match embedding_provider.as_str() {
        "openai" => "text-embedding-3-small",
        "google" => "text-embedding-004",
        "anthropic" | "voyage" => "voyage-code-3",
        _ => "text-embedding-3-small",
    };

    // Generate query embedding
    let embeddings = provider.embed_texts(&api_key, embed_model, &[query]).await?;

    if embeddings.is_empty() {
        return Ok(Vec::new());
    }

    // Create new database connection for search
    let db = db::Database::new()?;

    // Search for similar chunks
    let results = indexer::semantic_search(
        &db,
        &index_id,
        &embeddings[0],
        limit.unwrap_or(10) as usize,
        0.5, // Default threshold
    )?;

    Ok(results.into_iter().map(|(chunk, _score)| chunk).collect())
}

// Agent settings commands

#[tauri::command]
fn agents_get_settings(
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<AgentSettings>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_agent_settings(&user.id)
}

#[tauri::command]
fn agents_save_setting(
    agent_type: String,
    model_override: Option<String>,
    custom_prompt: Option<String>,
    enabled: bool,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<AgentSettings> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.save_agent_setting(
        &user.id,
        &agent_type,
        model_override.as_deref(),
        custom_prompt.as_deref(),
        enabled,
    )
}

#[derive(serde::Serialize)]
pub struct AgentInfo {
    pub agent_type: String,
    pub name: String,
    pub description: String,
    pub default_prompt: String,
}

#[tauri::command]
fn agents_get_defaults() -> Vec<AgentInfo> {
    vec![
        AgentInfo {
            agent_type: "security".to_string(),
            name: "Security Agent".to_string(),
            description: "Scans for security vulnerabilities, OWASP Top 10, and potential risks".to_string(),
            default_prompt: prompts::get_system_prompt(AgentType::Security).to_string(),
        },
        AgentInfo {
            agent_type: "architecture".to_string(),
            name: "Architecture Agent".to_string(),
            description: "Reviews code structure, SOLID principles, and design patterns".to_string(),
            default_prompt: prompts::get_system_prompt(AgentType::Architecture).to_string(),
        },
        AgentInfo {
            agent_type: "style".to_string(),
            name: "Style Agent".to_string(),
            description: "Checks naming conventions, consistency, and documentation".to_string(),
            default_prompt: prompts::get_system_prompt(AgentType::Style).to_string(),
        },
        AgentInfo {
            agent_type: "performance".to_string(),
            name: "Performance Agent".to_string(),
            description: "Identifies performance issues and optimization opportunities".to_string(),
            default_prompt: prompts::get_system_prompt(AgentType::Performance).to_string(),
        },
    ]
}

// Service Keys commands (for SerpAPI, etc.)

#[tauri::command]
fn service_keys_get(state: State<'_, Mutex<AppState>>) -> AppResult<Vec<db::ServiceKeyInfo>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_service_keys(&user.id)
}

#[tauri::command]
fn service_keys_set(
    service_name: String,
    api_key: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.set_service_key(&user.id, &service_name, &api_key)
}

#[tauri::command]
fn service_keys_delete(
    service_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.delete_service_key(&user.id, &service_name)
}

// MCP Server commands

#[tauri::command]
fn mcp_get_servers(
    agent_type: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<db::MCPServerConfig>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_mcp_servers(&user.id, &agent_type)
}

#[tauri::command]
fn mcp_get_all_servers(state: State<'_, Mutex<AppState>>) -> AppResult<Vec<db::MCPServerConfig>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_all_mcp_servers(&user.id)
}

#[tauri::command]
fn mcp_add_server(
    agent_type: String,
    server_name: String,
    server_command: String,
    server_args: Vec<String>,
    server_env: std::collections::HashMap<String, String>,
    transport_type: String,
    http_url: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<db::MCPServerConfig> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.add_mcp_server(
        &user.id,
        &agent_type,
        &server_name,
        &server_command,
        &server_args,
        &server_env,
        &transport_type,
        http_url.as_deref(),
    )
}

#[tauri::command]
fn mcp_remove_server(
    agent_type: String,
    server_name: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<()> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.delete_mcp_server(&user.id, &agent_type, &server_name)
}

#[tauri::command]
fn mcp_test_server(
    server_command: String,
    server_args: Vec<String>,
    server_env: std::collections::HashMap<String, String>,
    transport_type: String,
    http_url: Option<String>,
) -> AppResult<Vec<MCPTool>> {
    // Create a temporary config for testing
    let config = db::MCPServerConfig {
        id: String::new(),
        user_id: String::new(),
        agent_type: String::new(),
        server_name: "test".to_string(),
        server_command,
        server_args,
        server_env,
        transport_type,
        http_url,
        enabled: true,
        created_at: String::new(),
        updated_at: String::new(),
    };

    let manager = MCPManager::new();
    manager.test_connection(&config)
}

// Research Agent Settings commands

#[tauri::command]
fn research_agent_get_settings(
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Option<db::ResearchAgentSettings>> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.get_research_agent_settings(&user.id)
}

#[tauri::command]
fn research_agent_save_settings(
    model_preference: Option<String>,
    max_iterations: u32,
    timeout_seconds: u32,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<db::ResearchAgentSettings> {
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    app.db.save_research_agent_settings(
        &user.id,
        model_preference.as_deref(),
        max_iterations,
        timeout_seconds,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let app_state = Mutex::new(AppState { db });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            auth_get_oauth_url,
            auth_exchange_code,
            auth_get_user,
            auth_logout,
            settings_get_ai_providers,
            settings_add_ai_provider,
            settings_activate_ai_provider,
            settings_delete_ai_provider,
            settings_fetch_models,
            settings_fetch_models_for_provider,
            favorites_get,
            favorites_add,
            favorites_remove,
            github_get_repos,
            github_get_repo_prs,
            github_get_repo_pr_count,
            github_get_user_reviewed_prs,
            github_get_pr,
            github_get_pr_files,
            github_compare_commits,
            github_get_file_content,
            github_submit_review,
            ai_analyze_pr,
            ai_analyze_pr_orchestrated,
            review_get_state,
            review_save_state,
            analysis_get,
            analysis_save,
            codebase_get_linked_repos,
            codebase_get_linked_repo,
            codebase_link_repo,
            codebase_unlink_repo,
            codebase_analyze,
            codebase_get_context_summary,
            codebase_clone_repo,
            codebase_index_start,
            codebase_index_status,
            codebase_semantic_search,
            agents_get_settings,
            agents_save_setting,
            agents_get_defaults,
            service_keys_get,
            service_keys_set,
            service_keys_delete,
            mcp_get_servers,
            mcp_get_all_servers,
            mcp_add_server,
            mcp_remove_server,
            mcp_test_server,
            research_agent_get_settings,
            research_agent_save_settings,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Emitter;
                use tauri_plugin_deep_link::DeepLinkExt;

                let handle = app.handle().clone();

                // Handle deep links received while app is running
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        println!("Deep link received: {}", url);
                        // Parse the OAuth callback URL to extract the code
                        if let Some(code) = url.query_pairs()
                            .find(|(key, _)| key == "code")
                            .map(|(_, value)| value.to_string())
                        {
                            println!("OAuth code: {}", code);
                            // Emit to frontend
                            let _ = handle.emit("oauth-callback", code);
                        }
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
