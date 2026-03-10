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

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  context_length: number | null;
  description: string | null;
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
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
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

// Agent system types
export type AgentType = "security" | "architecture" | "style" | "performance";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type AnnotationType = "warning" | "info" | "suggestion";

export interface AgentSummary {
  overview: string;
  risk_assessment: string;
  top_concerns: string[];
}

export interface AgentFinding {
  file: string;
  line: number | null;
  message: string;
  severity: Severity;
  category: string;
  suggestion: string | null;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AgentResponse {
  agent_type: AgentType;
  summary: AgentSummary;
  findings: AgentFinding[];
  priority_files: string[];
  processing_time_ms: number;
  token_usage: TokenUsage | null;
}

export interface FailedAgent {
  agent_type: AgentType;
  error: string;
}

export interface FilePriority {
  filename: string;
  priority_score: number;
  reasons: string[];
}

export interface LineAnnotation {
  line_number: number;
  row_index: number | null;
  annotation_type: AnnotationType;
  message: string;
  sources: AgentType[];
  severity: Severity;
  category: string;
  suggestion: string | null;
}

export interface FileContext {
  summary: string;
  purpose: string;
  related_files: string[];
}

export interface FileAnalysis {
  filename: string;
  importance_score: number;
  annotations: LineAnnotation[];
  context: FileContext;
  agent_findings: AgentFinding[];
}

// File grouping types (Issue 4)
export interface FileGroup {
  name: string;
  description: string;
  importance: string; // "high" | "medium" | "low"
  files: GroupedFile[];
}

export interface GroupedFile {
  filename: string;
  deprioritized: boolean;
  reason: string | null;
}

export interface OrchestratedAnalysis {
  summary: string;
  risk_level: string;
  file_priorities: FilePriority[];
  file_analyses: FileAnalysis[];
  categories: PRCategory[];
  key_changes: KeyChange[];
  suggested_review_order: string[];
  agent_responses: AgentResponse[];
  failed_agents: FailedAgent[];
  total_processing_time_ms: number;
  total_token_usage: TokenUsage;
  file_groups?: FileGroup[];
}

// Auth API
export const auth = {
  getOAuthUrl: () => invoke<string>("auth_get_oauth_url"),
  exchangeCode: (code: string) => invoke<User>("auth_exchange_code", { code }),
  getUser: () => invoke<User | null>("auth_get_user"),
  logout: (keepData: boolean) => invoke<void>("auth_logout", { keepData }),
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
  fetchModels: (provider: string, apiKeyOrUrl: string) =>
    invoke<ModelInfo[]>("settings_fetch_models", { provider, apiKeyOrUrl }),
  fetchModelsForProvider: (provider: string) =>
    invoke<ModelInfo[]>("settings_fetch_models_for_provider", { provider }),
};

// Review comment to be submitted with a review
export interface ReviewComment {
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT" | null;
  body: string;
}

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
  compareCommits: (owner: string, repo: string, base: string, head: string) =>
    invoke<GitHubFile[]>("github_compare_commits", { owner, repo, base, head }),
  getFileContent: (owner: string, repo: string, path: string, refName: string) =>
    invoke<string>("github_get_file_content", { owner, repo, path, refName }),
  submitReview: (
    owner: string,
    repo: string,
    prNumber: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: ReviewComment[]
  ) =>
    invoke<void>("github_submit_review", { owner, repo, prNumber, event, body, comments }),
};

// AI API
export const ai = {
  analyzePR: (url: string) => invoke<PRAnalysis>("ai_analyze_pr", { url }),
  analyzePROrchestrated: (url: string, withCodebaseContext?: boolean) =>
    invoke<OrchestratedAnalysis>("ai_analyze_pr_orchestrated", { url, withCodebaseContext }),
};

// Analysis Cache API
export const analysis = {
  get: (owner: string, repo: string, prNumber: number, headCommit: string) =>
    invoke<OrchestratedAnalysis | null>("analysis_get", { owner, repo, prNumber, headCommit }),
  save: (owner: string, repo: string, prNumber: number, headCommit: string, analysis: OrchestratedAnalysis) =>
    invoke<void>("analysis_save", { owner, repo, prNumber, headCommit, analysis }),
};

// Favorites API
export const favorites = {
  get: () => invoke<number[]>("favorites_get"),
  add: (repoId: number, repoFullName: string) =>
    invoke<void>("favorites_add", { repoId, repoFullName }),
  remove: (repoId: number) => invoke<void>("favorites_remove", { repoId }),
};

// Review State API
export interface PRReviewState {
  id: string;
  user_id: string;
  repo_owner: string;
  repo_name: string;
  pr_number: number;
  last_reviewed_commit: string;
  viewed_files: string[];
  created_at: string;
  updated_at: string;
}

export const review = {
  getState: (owner: string, repo: string, prNumber: number) =>
    invoke<PRReviewState | null>("review_get_state", { owner, repo, prNumber }),
  saveState: (
    owner: string,
    repo: string,
    prNumber: number,
    commitSha: string,
    viewedFiles: string[]
  ) =>
    invoke<PRReviewState>("review_save_state", {
      owner,
      repo,
      prNumber,
      commitSha,
      viewedFiles,
    }),
};

// Codebase Profile Types
export interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children: DirectoryEntry[] | null;
}

export interface ConfigFile {
  path: string;
  content: string;
  file_type: string;
}

export interface NamingConventions {
  files: string;
  functions: string;
  variables: string;
  types: string;
}

export interface CodebasePatterns {
  naming_conventions: NamingConventions;
  file_organization: string;
  common_abstractions: string[];
  import_style: string;
  error_handling_pattern: string;
}

export interface StyleSummary {
  indentation: string;
  quote_style: string;
  trailing_commas: boolean;
  documentation_style: string;
  typical_file_length: number;
}

export interface CodebaseProfile {
  repo_path: string;
  last_analyzed_commit: string | null;
  last_analyzed_at: string | null;
  directory_tree: DirectoryEntry[];
  file_count: number;
  language_breakdown: Record<string, number>;
  config_files: ConfigFile[];
  documentation_files?: ConfigFile[];
  patterns: CodebasePatterns;
  style_summary: StyleSummary;
}

export interface LinkedRepo {
  id: string;
  user_id: string;
  repo_full_name: string;
  local_path: string;
  last_analyzed_commit: string | null;
  profile_data: CodebaseProfile | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
}

// Codebase API
export const codebase = {
  getLinkedRepos: () => invoke<LinkedRepo[]>("codebase_get_linked_repos"),
  getLinkedRepo: (repoFullName: string) =>
    invoke<LinkedRepo | null>("codebase_get_linked_repo", { repoFullName }),
  linkRepo: (repoFullName: string, localPath: string) =>
    invoke<LinkedRepo>("codebase_link_repo", { repoFullName, localPath }),
  unlinkRepo: (repoFullName: string) =>
    invoke<void>("codebase_unlink_repo", { repoFullName }),
  analyze: (repoFullName: string) =>
    invoke<CodebaseProfile>("codebase_analyze", { repoFullName }),
  getContextSummary: (repoFullName: string) =>
    invoke<string | null>("codebase_get_context_summary", { repoFullName }),
  cloneRepo: (repoFullName: string, destinationPath: string) =>
    invoke<LinkedRepo>("codebase_clone_repo", { repoFullName, destinationPath }),
};

// Agent Settings Types
export interface AgentSettings {
  id: string;
  user_id: string;
  agent_type: string;
  model_override: string | null;
  custom_prompt: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentInfo {
  agent_type: string;
  name: string;
  description: string;
  default_prompt: string;
}

// Agents API
export const agents = {
  getSettings: () => invoke<AgentSettings[]>("agents_get_settings"),
  saveSetting: (
    agentType: string,
    modelOverride: string | null,
    customPrompt: string | null,
    enabled: boolean
  ) =>
    invoke<AgentSettings>("agents_save_setting", {
      agentType,
      modelOverride,
      customPrompt,
      enabled,
    }),
  getDefaults: () => invoke<AgentInfo[]>("agents_get_defaults"),
  getEmbeddingCapability: () =>
    invoke<{ available: boolean; provider: string | null }>(
      "agents_get_embedding_capability"
    ),
};

// Service Keys (for SerpAPI, etc.)
export interface ServiceKeyInfo {
  id: string;
  user_id: string;
  service_name: string;
  created_at: string;
  updated_at: string;
}

export const serviceKeys = {
  get: () => invoke<ServiceKeyInfo[]>("service_keys_get"),
  set: (serviceName: string, apiKey: string) =>
    invoke<void>("service_keys_set", { serviceName, apiKey }),
  delete: (serviceName: string) =>
    invoke<void>("service_keys_delete", { serviceName }),
};

// MCP Tool from server discovery
export interface MCPTool {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
}

// MCP Server Configuration
export interface MCPServerConfig {
  id: string;
  user_id: string;
  agent_type: string;
  server_name: string;
  server_command: string;
  server_args: string[];
  server_env: Record<string, string>;
  transport_type: string;
  http_url: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const mcp = {
  getServers: (agentType: string) =>
    invoke<MCPServerConfig[]>("mcp_get_servers", { agentType }),
  getAllServers: () => invoke<MCPServerConfig[]>("mcp_get_all_servers"),
  addServer: (
    agentType: string,
    serverName: string,
    serverCommand: string,
    serverArgs: string[],
    serverEnv: Record<string, string>,
    transportType: string,
    httpUrl: string | null
  ) =>
    invoke<MCPServerConfig>("mcp_add_server", {
      agentType,
      serverName,
      serverCommand,
      serverArgs,
      serverEnv,
      transportType,
      httpUrl,
    }),
  removeServer: (agentType: string, serverName: string) =>
    invoke<void>("mcp_remove_server", { agentType, serverName }),
  testServer: (
    serverCommand: string,
    serverArgs: string[],
    serverEnv: Record<string, string>,
    transportType: string,
    httpUrl: string | null
  ) =>
    invoke<MCPTool[]>("mcp_test_server", {
      serverCommand,
      serverArgs,
      serverEnv,
      transportType,
      httpUrl,
    }),
};

// Research Agent Settings
export interface ResearchAgentSettings {
  id: string;
  user_id: string;
  model_preference: string | null;
  max_iterations: number;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

export const researchAgent = {
  getSettings: () =>
    invoke<ResearchAgentSettings | null>("research_agent_get_settings"),
  saveSettings: (
    modelPreference: string | null,
    maxIterations: number,
    timeoutSeconds: number
  ) =>
    invoke<ResearchAgentSettings>("research_agent_save_settings", {
      modelPreference,
      maxIterations,
      timeoutSeconds,
    }),
};

// Draft Comments
export interface DraftComment {
  id: string;
  user_id: string;
  repo_owner: string;
  repo_name: string;
  pr_number: number;
  file_path: string;
  line_start: number;
  line_end: number;
  body: string;
  created_at: string;
  updated_at: string;
}

export const draftComments = {
  save: (owner: string, repo: string, prNumber: number, filePath: string, lineStart: number, lineEnd: number, body: string) =>
    invoke<DraftComment>("draft_comments_save", { owner, repo, prNumber, filePath, lineStart, lineEnd, body }),
  get: (owner: string, repo: string, prNumber: number) =>
    invoke<DraftComment[]>("draft_comments_get", { owner, repo, prNumber }),
  update: (id: string, body: string) =>
    invoke<void>("draft_comments_update", { id, body }),
  delete: (id: string) =>
    invoke<void>("draft_comments_delete", { id }),
  clear: (owner: string, repo: string, prNumber: number) =>
    invoke<void>("draft_comments_clear", { owner, repo, prNumber }),
};

// Codebase Indexing Types
export type IndexStatus = "pending" | "indexing" | "complete" | "failed";
export type ChunkType = "function" | "method" | "class" | "struct" | "interface" | "enum" | "trait" | "module";

export interface CodebaseIndexStatus {
  id: string;
  repo_full_name: string;
  local_path: string;
  last_indexed_commit: string | null;
  embedding_provider: string;
  embedding_model: string;
  total_chunks: number;
  index_status: IndexStatus;
  error_message: string | null;
  files_total: number;
  files_processed: number;
  chunks_processed: number;
  created_at: string;
  updated_at: string;
}

export interface ChunkMetadata {
  id: number;
  index_id: string;
  file_path: string;
  chunk_type: ChunkType;
  name: string;
  signature: string | null;
  language: string;
  start_line: number;
  end_line: number;
  content: string;
  docstring: string | null;
  parent_name: string | null;
  visibility: string | null;
  created_at: string;
}

export interface SemanticSearchResult {
  chunk: ChunkMetadata;
  similarity: number;
}

// Codebase Indexing API
export const indexing = {
  start: (repoFullName: string, withEmbeddings?: boolean) =>
    invoke<void>("codebase_index_start", { repoFullName, withEmbeddings }),
  getStatus: (repoFullName: string) =>
    invoke<CodebaseIndexStatus | null>("codebase_index_status", { repoFullName }),
  semanticSearch: (repoFullName: string, query: string, limit?: number, threshold?: number) =>
    invoke<SemanticSearchResult[]>("codebase_semantic_search", { repoFullName, query, limit, threshold }),
};
