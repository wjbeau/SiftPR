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

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  private: boolean;
  html_url: string;
  description: string | null;
  open_issues_count: number;
}

export interface GitHubPRUser {
  login: string;
  avatar_url: string | null;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: GitHubPRUser;
  assignees: GitHubPRUser[] | null;
  base: { ref: string };
  head: { ref: string };
  created_at: string;
  updated_at: string;
  draft: boolean | null;
  mergeable_state: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  comments: number | null;
  review_comments: number | null;
  html_url: string;
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
  getRepos: () => invoke<GitHubRepo[]>("github_get_repos"),
  getRepoPRs: (owner: string, repo: string) =>
    invoke<GitHubPR[]>("github_get_repo_prs", { owner, repo }),
  getRepoPRCount: (owner: string, repo: string) =>
    invoke<number>("github_get_repo_pr_count", { owner, repo }),
  getUserReviewedPRs: (owner: string, repo: string, prNumbers: number[]) =>
    invoke<number[]>("github_get_user_reviewed_prs", { owner, repo, prNumbers }),
  getPR: (url: string) => invoke<GitHubPR>("github_get_pr", { url }),
  getPRFiles: (url: string) => invoke<GitHubFile[]>("github_get_pr_files", { url }),
};

// AI API
export const ai = {
  analyzePR: (url: string) => invoke<PRAnalysis>("ai_analyze_pr", { url }),
};

// Favorites API
export const favorites = {
  get: () => invoke<number[]>("favorites_get"),
  add: (repoId: number, repoFullName: string) =>
    invoke<void>("favorites_add", { repoId, repoFullName }),
  remove: (repoId: number) => invoke<void>("favorites_remove", { repoId }),
};
