import { invoke } from "@tauri-apps/api/core";

// Type definitions (matching Rust structs)
export interface User {
  id: string;
  github_username: string;
  github_avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AISettings {
  id: string;
  user_id: string;
  provider: string;
  model_preference: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  base: { ref_name: string };
  head: { ref_name: string };
  created_at: string;
  updated_at: string;
}

export interface GitHubFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PRAnalysis {
  summary: string;
  risk_level: string;
  categories: PRCategory[];
  key_changes: KeyChange[];
  suggested_review_order: string[];
}

export interface PRCategory {
  name: string;
  description: string;
  files: string[];
}

export interface KeyChange {
  file: string;
  line: number | null;
  description: string;
  importance: string;
}

// Auth API
export const auth = {
  getOAuthUrl: () => invoke<string>("auth_get_oauth_url"),
  exchangeCode: (code: string) => invoke<User>("auth_exchange_code", { code }),
  getUser: () => invoke<User | null>("auth_get_user"),
  logout: () => invoke<void>("auth_logout"),
};

// Settings API
export const settings = {
  getAIProviders: () => invoke<AISettings[]>("settings_get_ai_providers"),
  addAIProvider: (provider: string, apiKey: string, model: string) =>
    invoke<AISettings>("settings_add_ai_provider", { provider, apiKey, model }),
  activateAIProvider: (settingId: string) =>
    invoke<void>("settings_activate_ai_provider", { settingId }),
  deleteAIProvider: (settingId: string) =>
    invoke<void>("settings_delete_ai_provider", { settingId }),
};

// GitHub API
export const github = {
  getPR: (url: string) => invoke<GitHubPR>("github_get_pr", { url }),
  getPRFiles: (url: string) => invoke<GitHubFile[]>("github_get_pr_files", { url }),
};

// AI API
export const ai = {
  analyzePR: (url: string) => invoke<PRAnalysis>("ai_analyze_pr", { url }),
};
