# Claude Code Instructions for SiftPR

## Project Overview

SiftPR is an AI-powered desktop PR review tool built with Tauri. It helps developers review pull requests more efficiently by using AI to organize and analyze PR changes, highlighting important changes and suggesting review order.

## Tech Stack

- **Desktop Framework**: Tauri v2 (Rust backend + web frontend)
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query
- **Backend**: Rust with rusqlite, reqwest, aes-gcm
- **Database**: SQLite (stored in app data directory)

## Project Structure

```
SiftPR/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── contexts/           # React contexts (auth)
│   ├── lib/                # Utilities and API client
│   └── pages/              # Page components
├── src-tauri/              # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── lib.rs          # Tauri commands
│   │   ├── db.rs           # SQLite database
│   │   ├── github.rs       # GitHub API client
│   │   ├── ai.rs           # AI provider clients
│   │   ├── crypto.rs       # Encryption utilities
│   │   └── error.rs        # Error types
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Start Tauri dev mode (frontend + backend)
pnpm tauri:dev

# Build production app
pnpm tauri:build

# Frontend only (for UI development)
pnpm dev

# Type checking
pnpm typecheck
```

## Key Files

### Backend (Rust - `src-tauri/src/`)
- `lib.rs` - Tauri command handlers (main API)
- `db.rs` - SQLite database with rusqlite
- `github.rs` - GitHub OAuth and API client
- `ai.rs` - OpenAI, Anthropic, OpenRouter integrations
- `crypto.rs` - AES-GCM encryption for API keys
- `error.rs` - Error type definitions

### Frontend (`src/`)
- `App.tsx` - Main app with routing
- `contexts/AuthContext.tsx` - Auth state management
- `lib/api.ts` - Tauri invoke wrappers
- `pages/` - Page components
- `components/ui/` - shadcn/ui components

## Database Schema

SQLite database stored in system app data directory:
- `users` - GitHub-authenticated users (token encrypted)
- `reviews` - Saved PR reviews with AI analysis
- `review_comments` - Draft/submitted review comments
- `user_ai_settings` - User API keys for AI providers (encrypted)

## Tauri Commands

Commands are defined in `src-tauri/src/lib.rs` and invoked from frontend via `@tauri-apps/api/core`:

### Auth
- `auth_get_oauth_url` - Get GitHub OAuth URL
- `auth_exchange_code` - Exchange OAuth code for token
- `auth_get_user` - Get current user
- `auth_logout` - Logout user

### Settings
- `settings_get_ai_providers` - List AI providers
- `settings_add_ai_provider` - Add new provider
- `settings_activate_ai_provider` - Set active provider
- `settings_delete_ai_provider` - Remove provider

### GitHub
- `github_get_pr` - Fetch PR details
- `github_get_pr_files` - Fetch PR changed files

### AI
- `ai_analyze_pr` - Analyze PR with AI

## Architecture Notes

1. **No Server Process**: Everything runs in the Tauri app - no separate backend
2. **Authentication**: GitHub OAuth via system browser + deep link callback
3. **AI Integration**: Users provide their own API keys (stored encrypted)
4. **API Keys**: Encrypted with AES-256-GCM before SQLite storage
5. **State Management**: TanStack Query for server state, React context for auth

## Adding New Features

### New Tauri Command
1. Add function in `src-tauri/src/lib.rs` with `#[tauri::command]`
2. Register in `invoke_handler` macro in `run()` function
3. Add TypeScript wrapper in `src/lib/api.ts`

### New UI Component
1. Add to `src/components/`
2. Use shadcn/ui patterns from existing components

### Modify Database
1. Edit schema in `src-tauri/src/db.rs`
2. Run in dev mode - schema auto-migrates (add CREATE TABLE IF NOT EXISTS)

## GitHub OAuth Setup

1. Create GitHub OAuth App at https://github.com/settings/developers
2. Set callback URL to `siftpr://oauth/callback`
3. Update client ID/secret in `src-tauri/src/github.rs`

## Building for Production

```bash
pnpm tauri:build
```

This creates platform-specific installers in `src-tauri/target/release/bundle/`.
