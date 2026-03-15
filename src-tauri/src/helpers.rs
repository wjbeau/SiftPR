//! Helper functions for common patterns in Tauri commands

use std::sync::Mutex;
use tauri::State;

use crate::db::{Database, User};
use crate::error::{AppError, AppResult};
use crate::AppState;

/// Execute a closure with database access.
/// Acquires the lock, executes the closure, then releases the lock.
#[allow(dead_code)]
pub fn with_db<T, F>(state: &State<'_, Mutex<AppState>>, f: F) -> AppResult<T>
where
    F: FnOnce(&Database) -> AppResult<T>,
{
    let app = state.lock().unwrap();
    f(&app.db)
}

/// Get the current authenticated user, or return Unauthorized error.
#[allow(dead_code)]
pub fn require_auth(state: &State<'_, Mutex<AppState>>) -> AppResult<User> {
    let app = state.lock().unwrap();
    app.db.get_current_user()?.ok_or(AppError::Unauthorized)
}

/// Execute a closure with database access after verifying authentication.
/// Returns the user and allows operations on the database.
/// This is the most common pattern - check auth then do something with db.
#[allow(dead_code)]
pub fn with_auth<T, F>(state: &State<'_, Mutex<AppState>>, f: F) -> AppResult<T>
where
    F: FnOnce(&Database, &User) -> AppResult<T>,
{
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    f(&app.db, &user)
}

/// Execute a closure with just the user_id after verifying authentication.
/// Useful when you only need the user_id string, not the full User object.
pub fn with_user_id<T, F>(state: &State<'_, Mutex<AppState>>, f: F) -> AppResult<T>
where
    F: FnOnce(&Database, &str) -> AppResult<T>,
{
    let app = state.lock().unwrap();
    let user = app.db.get_current_user()?.ok_or(AppError::Unauthorized)?;
    f(&app.db, &user.id)
}
