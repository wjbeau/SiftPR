mod ai;
mod crypto;
mod db;
mod error;
mod github;

use std::sync::Mutex;
use tauri::State;

use ai::AIClient;
use db::{AISettings, Database, User};
use error::{AppError, AppResult};
use github::{GitHubClient, GitHubFile, GitHubPR, GitHubRepo};

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

    // Exchange code for token
    let token = client.exchange_code(&code).await?;

    // Get user info
    let github_user = client.get_user(&token).await?;

    // Save to database (lock only for DB operation)
    let user = {
        let app = state.lock().unwrap();
        app.db.upsert_user(
            &github_user.id.to_string(),
            &github_user.login,
            Some(&github_user.avatar_url),
            &token,
        )?
    };

    Ok(user)
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
    app.db.add_ai_settings(&user.id, &provider, &api_key, &model)
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
    // Get token from DB (short lock)
    let token = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        app.db.get_github_token(&user.id)?
    };

    // Make async call without holding lock
    let client = GitHubClient::new();
    client.get_repos(&token).await
}

#[tauri::command]
async fn github_get_repo_prs(
    owner: String,
    repo: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<GitHubPR>> {
    // Get token from DB (short lock)
    let token = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        app.db.get_github_token(&user.id)?
    };

    // Make async call without holding lock
    let client = GitHubClient::new();
    client.get_repo_prs(&token, &owner, &repo).await
}

#[tauri::command]
async fn github_get_repo_pr_count(
    owner: String,
    repo: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<i64> {
    // Get token from DB (short lock)
    let token = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        app.db.get_github_token(&user.id)?
    };

    // Make async call without holding lock
    let client = GitHubClient::new();
    client.get_repo_pr_count(&token, &owner, &repo).await
}

#[tauri::command]
async fn github_get_pr(
    url: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<GitHubPR> {
    let (owner, repo, pr_number) = github::parse_pr_url(&url)?;

    // Get token from DB (short lock)
    let token = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        app.db.get_github_token(&user.id)?
    };

    // Make async call without holding lock
    let client = GitHubClient::new();
    client.get_pr(&token, &owner, &repo, pr_number).await
}

#[tauri::command]
async fn github_get_pr_files(
    url: String,
    state: State<'_, Mutex<AppState>>,
) -> AppResult<Vec<GitHubFile>> {
    let (owner, repo, pr_number) = github::parse_pr_url(&url)?;

    // Get token from DB (short lock)
    let token = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        app.db.get_github_token(&user.id)?
    };

    // Make async call without holding lock
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

    // Get user data and AI settings from DB (short lock)
    let (token, provider, api_key, model) = {
        let app = state.lock().unwrap();
        let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
        let token = app.db.get_github_token(&user.id)?;
        let (settings, key) = app.db.get_active_ai_setting(&user.id)?
            .ok_or(AppError::AIProvider("No AI provider configured".to_string()))?;
        (token, settings.provider, key, settings.model_preference)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let app_state = Mutex::new(AppState { db });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
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
            favorites_get,
            favorites_add,
            favorites_remove,
            github_get_repos,
            github_get_repo_prs,
            github_get_repo_pr_count,
            github_get_pr,
            github_get_pr_files,
            ai_analyze_pr,
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
