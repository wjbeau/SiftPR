# SiftPR

AI-powered desktop PR review tool that helps you identify important changes and organize your code review workflow.

## Features

- **Desktop App**: Native application built with Tauri (macOS, Windows, Linux)
- **GitHub Integration**: OAuth login to access your repositories
- **AI Analysis**: Uses AI to organize PR changes into logical categories
- **Review Comments**: Draft and submit review comments
- **Multiple AI Providers**: Support for OpenAI, Anthropic, and OpenRouter (bring your own API keys)
- **Secure Storage**: API keys encrypted with AES-256-GCM

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Rust](https://rustup.rs/) (latest stable)
- GitHub OAuth App credentials

## Quick Start

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Set up GitHub OAuth**
   - Create a GitHub OAuth App at https://github.com/settings/developers
   - Set Callback URL to `reviewboss://oauth/callback`
   - Update credentials in `src-tauri/src/github.rs`

3. **Start development**

   ```bash
   pnpm tauri:dev
   ```

   This will compile the Rust backend and launch the app with hot-reload.

## Project Structure

```
ReviewBoss/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── contexts/           # React contexts
│   ├── lib/                # API client & utilities
│   └── pages/              # Page components
├── src-tauri/              # Tauri Rust backend
│   ├── src/                # Rust source code
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── package.json
└── vite.config.ts
```

## Development

```bash
# Start Tauri dev mode
pnpm tauri:dev

# Frontend only (UI development)
pnpm dev

# Build production app
pnpm tauri:build

# Type checking
pnpm typecheck
```

## Tech Stack

- **Desktop**: Tauri v2 (Rust + WebView)
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Rust, rusqlite, reqwest, aes-gcm
- **Database**: SQLite (local, in app data directory)

## How It Works

1. **Login**: Click "Login with GitHub" to authenticate via your browser
2. **Configure AI**: Go to Settings and add your AI provider API key
3. **Review PR**: Paste a GitHub PR URL and click "Start Review"
4. **AI Analysis**: The app fetches PR data and analyzes it with your chosen AI model
5. **Review**: Navigate through categorized changes and leave comments

## Building for Production

```bash
pnpm tauri:build
```

This creates platform-specific installers:

- **macOS**: `.dmg` and `.app`
- **Windows**: `.msi` and `.exe`
- **Linux**: `.deb`, `.AppImage`, `.rpm`

Output: `src-tauri/target/release/bundle/`

## Security

- GitHub tokens stored encrypted in local SQLite database
- AI API keys encrypted with AES-256-GCM
- No data sent to external servers (except GitHub API and your chosen AI provider)

## License

MIT

## TODO

The following feature ideas need implementation:

- Improved agent performance (consider RLM, tools, MCP integration, and scope it to the local repo etc)
- Pre-ingest repo code into vector db and provide as embedding and check what current repo analysis does
