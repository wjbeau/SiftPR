import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { agents, codebase, github, indexing, CodebaseIndexStatus } from "@/lib/api";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Folder,
  Trash2,
  GitBranch,
  Clock,
  RefreshCw,
  Loader2,
  AlertTriangle,
  FolderGit,
  Download,
  FolderOpen,
  Database,
  CheckCircle,
  XCircle,
  FileCode,
  Layers,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Braces,
  Settings2,
  Square,
} from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export function Repositories() {
  const queryClient = useQueryClient();
  const [linkRepoName, setLinkRepoName] = useState("");
  const [linkLocalPath, setLinkLocalPath] = useState("");
  const [cloneRepoName, setCloneRepoName] = useState("");
  const [cloneDestPath, setCloneDestPath] = useState("");
  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);
  const [indexingRepo, setIndexingRepo] = useState<string | null>(null);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);

  // GitHub repos query
  const { data: githubRepos } = useQuery({
    queryKey: ["github", "repos"],
    queryFn: () => github.getRepos(),
  });

  // Linked repos query
  const { data: linkedRepos, isLoading: linkedReposLoading } = useQuery({
    queryKey: ["codebase", "linked"],
    queryFn: () => codebase.getLinkedRepos(),
  });

  // Index status queries for linked repos
  const indexStatusQueries = useQuery({
    queryKey: ["codebase", "index-status", linkedRepos?.map(r => r.repo_full_name)],
    queryFn: async () => {
      if (!linkedRepos) return {};
      const statuses: Record<string, CodebaseIndexStatus | null> = {};
      for (const repo of linkedRepos) {
        statuses[repo.repo_full_name] = await indexing.getStatus(repo.repo_full_name);
      }
      return statuses;
    },
    enabled: !!linkedRepos && linkedRepos.length > 0,
    refetchInterval: (query) => {
      // Poll every 2s while any repo is indexing or pending
      const statuses = query.state.data;
      if (statuses) {
        const isAnyIndexing = Object.values(statuses).some(
          (s) => s?.status === "indexing" || s?.status === "pending"
        );
        if (isAnyIndexing) return 2000;
      }
      return false;
    },
  });

  // Check if embedding-capable provider is configured (via internal agent config)
  const { data: embeddingCapability } = useQuery({
    queryKey: ["agents", "embedding-capability"],
    queryFn: () => agents.getEmbeddingCapability(),
  });

  const linkRepoMutation = useMutation({
    mutationFn: (data: { repoFullName: string; localPath: string }) =>
      codebase.linkRepo(data.repoFullName, data.localPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setLinkRepoName("");
      setLinkLocalPath("");
    },
  });

  const unlinkRepoMutation = useMutation({
    mutationFn: (repoFullName: string) => codebase.unlinkRepo(repoFullName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
    },
  });

  const analyzeRepoMutation = useMutation({
    mutationFn: (repoFullName: string) => codebase.analyze(repoFullName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setAnalyzingRepo(null);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setAnalyzingRepo(null);
    },
  });

  const [indexError, setIndexError] = useState<string | null>(null);

  const indexRepoMutation = useMutation({
    mutationFn: ({ repoFullName, withEmbeddings }: { repoFullName: string; withEmbeddings: boolean }) =>
      indexing.start(repoFullName, withEmbeddings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "index-status"] });
      setIndexError(null);
      // Don't clear indexingRepo here; let polling detect completion
    },
    onError: (error) => {
      logger.error("Indexing failed:", error);
      const msg = typeof error === "string" ? error : (error as Error)?.message || JSON.stringify(error);
      setIndexError(msg);
      setIndexingRepo(null);
      // Refresh status to show the failed state from DB
      queryClient.invalidateQueries({ queryKey: ["codebase", "index-status"] });
    },
  });

  const cloneRepoMutation = useMutation({
    mutationFn: (data: { repoFullName: string; destinationPath: string }) =>
      codebase.cloneRepo(data.repoFullName, data.destinationPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setCloneRepoName("");
      setCloneDestPath("");
    },
  });

  const handleLinkRepo = (e: React.FormEvent) => {
    e.preventDefault();
    linkRepoMutation.mutate({ repoFullName: linkRepoName, localPath: linkLocalPath });
  };

  const handleCloneRepo = (e: React.FormEvent) => {
    e.preventDefault();
    cloneRepoMutation.mutate({ repoFullName: cloneRepoName, destinationPath: cloneDestPath });
  };

  const handleBrowseFolder = async (setPath: (path: string) => void) => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Repository Folder",
    });
    if (selected && typeof selected === "string") {
      setPath(selected);
    }
  };

  const handleAnalyzeRepo = (repoFullName: string) => {
    setAnalyzingRepo(repoFullName);
    analyzeRepoMutation.mutate(repoFullName);
  };

  const handleIndexRepo = (repoFullName: string) => {
    setIndexingRepo(repoFullName);
    setIndexError(null);
    indexRepoMutation.mutate({ repoFullName, withEmbeddings: true });
    // Trigger immediate refetch so polling starts right away
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "index-status"] });
    }, 500);
  };

  // Clear transient indexingRepo once the DB status catches up
  const currentStatuses = indexStatusQueries.data;
  if (indexingRepo && currentStatuses?.[indexingRepo]) {
    const status = currentStatuses[indexingRepo]!.status;
    if (status === "indexing" || status === "pending" || status === "complete" || status === "failed") {
      // DB has the real status now, no need for the local flag
      setTimeout(() => setIndexingRepo(null), 0);
    }
  }

  const getIndexStatusInfo = (repoFullName: string): { label: string; color: string; isStale: boolean; progress: string | null } => {
    const indexStatus = indexStatusQueries.data?.[repoFullName];
    const linkedRepo = linkedRepos?.find(r => r.repo_full_name === repoFullName);

    if (!indexStatus) {
      if (repoFullName === indexingRepo) {
        return { label: "Indexing...", color: "text-blue-600 dark:text-blue-400", isStale: false, progress: "Starting..." };
      }
      return { label: "Not indexed", color: "text-muted-foreground", isStale: false, progress: null };
    }

    if (indexStatus.status === "failed") {
      return { label: "Index failed", color: "text-destructive", isStale: false, progress: null };
    }

    if (indexStatus.status === "indexing" || indexStatus.status === "pending") {
      const ft = indexStatus.files_total || 0;
      const fp = indexStatus.files_processed || 0;
      const cp = indexStatus.chunks_processed || 0;

      let progress: string;
      if (ft > 0 && fp < ft) {
        progress = `Parsing files (${fp}/${ft})`;
      } else if (ft > 0 && fp >= ft && cp > 0) {
        progress = `Generating embeddings (${cp} chunks)`;
      } else {
        progress = "Starting...";
      }

      return { label: "Indexing...", color: "text-blue-600 dark:text-blue-400", isStale: false, progress };
    }

    if (indexStatus.status === "complete") {
      const isStale = linkedRepo?.last_analyzed_commit &&
        indexStatus.last_indexed_commit !== linkedRepo.last_analyzed_commit;

      if (isStale) {
        return { label: "Index out of date", color: "text-amber-600 dark:text-amber-400", isStale: true, progress: null };
      }

      return {
        label: `Indexed (${indexStatus.total_chunks} chunks)`,
        color: "text-green-600 dark:text-green-400",
        isStale: false,
        progress: null,
      };
    }

    return { label: "Pending", color: "text-muted-foreground", isStale: false, progress: null };
  };

  // Filter out already linked repos
  const availableReposToLink = githubRepos?.filter(
    (repo) => !linkedRepos?.some((lr) => lr.repo_full_name === repo.full_name)
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">Repositories</h2>
        <p className="text-muted-foreground">
          Link local repository clones for enhanced AI analysis with codebase context.
        </p>
      </div>

      {/* Warning about branch switching */}
      <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Important: Repository Changes
              </p>
              <p className="text-amber-700 dark:text-amber-300 mt-1">
                When reviewing PRs, SiftPR may need to switch branches in linked repositories to analyze code.
                We recommend using a dedicated clone for reviews if you have uncommitted changes you want to preserve.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Repositories */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FolderGit className="h-4 w-4" />
            Linked Repositories
          </CardTitle>
          <CardDescription>
            Local repository clones that provide codebase context for AI reviews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkedReposLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : linkedRepos && linkedRepos.length > 0 ? (
            <div className="space-y-3">
              {linkedRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-green-100 dark:bg-green-950">
                        <GitBranch className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <div className="font-medium">{repo.repo_full_name}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-1">
                          <Folder className="h-3 w-3" />
                          {repo.local_path}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => unlinkRepoMutation.mutate(repo.repo_full_name)}
                      disabled={unlinkRepoMutation.isPending}
                      title="Unlink repository"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>

                  {/* Analysis Status Row */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-muted-foreground">
                        {repo.last_analyzed_commit ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                            <span className="text-foreground font-medium">Analyzed</span>
                            <span className="ml-1">at {repo.last_analyzed_commit.slice(0, 7)}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Not analyzed yet
                          </span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAnalyzeRepo(repo.repo_full_name)}
                        disabled={analyzingRepo === repo.repo_full_name}
                      >
                        {analyzingRepo === repo.repo_full_name ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {repo.last_analyzed_commit ? "Re-analyze" : "Analyze"}
                          </>
                        )}
                      </Button>
                    </div>
                    {repo.profile_data && (
                      <div className="pl-6 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <FileCode className="h-3 w-3" />
                            {repo.profile_data.file_count} files
                          </span>
                          {repo.profile_data.language_breakdown && Object.keys(repo.profile_data.language_breakdown).length > 0 && (() => {
                            const langs = Object.keys(repo.profile_data.language_breakdown);
                            return (
                              <span className="flex items-center gap-1">
                                <Layers className="h-3 w-3" />
                                {langs.slice(0, 4).join(", ")}
                                {langs.length > 4 && ` +${langs.length - 4}`}
                              </span>
                            );
                          })()}
                          {repo.profile_data.documentation_files && repo.profile_data.documentation_files.length > 0 && (
                            <span className="text-green-600 dark:text-green-400">
                              {repo.profile_data.documentation_files.length} doc{repo.profile_data.documentation_files.length !== 1 ? "s" : ""} found
                            </span>
                          )}
                          <button
                            onClick={() => setExpandedProfile(
                              expandedProfile === repo.repo_full_name ? null : repo.repo_full_name
                            )}
                            className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {expandedProfile === repo.repo_full_name ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            View details
                          </button>
                        </div>

                        {/* Expanded profile details */}
                        {expandedProfile === repo.repo_full_name && repo.profile_data && (
                          <div className="mt-2 p-3 bg-muted/50 rounded-md space-y-3 text-xs">
                            {/* AI Summary */}
                            {repo.ai_summary ? (
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-1 mb-1.5">
                                  <Layers className="h-3 w-3 text-violet-500" />
                                  AI Profiler Summary
                                </div>
                                <div className="prose prose-xs dark:prose-invert max-w-none text-xs text-muted-foreground [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground whitespace-pre-wrap">
                                  {repo.ai_summary}
                                </div>
                              </div>
                            ) : analyzingRepo !== repo.repo_full_name && (
                              <div className="text-muted-foreground italic">
                                No AI summary yet. Click "Re-analyze" to generate one (requires an AI provider).
                              </div>
                            )}

                            <div className="border-t pt-2" />

                            {/* Languages */}
                            {repo.profile_data.language_breakdown && Object.keys(repo.profile_data.language_breakdown).length > 0 && (
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                                  <Layers className="h-3 w-3" />
                                  Languages
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(repo.profile_data.language_breakdown)
                                    .sort(([, a], [, b]) => b - a)
                                    .map(([lang, count]) => (
                                      <span key={lang} className="px-1.5 py-0.5 bg-background border rounded text-muted-foreground">
                                        {lang} <span className="text-foreground font-medium">{count}</span>
                                      </span>
                                    ))}
                                </div>
                              </div>
                            )}

                            {/* Patterns */}
                            {repo.profile_data.patterns && (
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                                  <Braces className="h-3 w-3" />
                                  Detected Patterns
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                                  {repo.profile_data.patterns.file_organization && (
                                    <div>Structure: <span className="text-foreground">{repo.profile_data.patterns.file_organization}</span></div>
                                  )}
                                  {repo.profile_data.patterns.import_style && (
                                    <div>Imports: <span className="text-foreground">{repo.profile_data.patterns.import_style}</span></div>
                                  )}
                                  {repo.profile_data.patterns.error_handling_pattern && (
                                    <div>Errors: <span className="text-foreground">{repo.profile_data.patterns.error_handling_pattern}</span></div>
                                  )}
                                  {typeof repo.profile_data.patterns.naming_conventions === "string"
                                    ? repo.profile_data.patterns.naming_conventions && (
                                        <div>Naming: <span className="text-foreground">{repo.profile_data.patterns.naming_conventions}</span></div>
                                      )
                                    : repo.profile_data.patterns.naming_conventions?.functions && (
                                        <div>Naming: <span className="text-foreground">{repo.profile_data.patterns.naming_conventions.functions}</span></div>
                                      )}
                                </div>
                                {repo.profile_data.patterns.common_abstractions && repo.profile_data.patterns.common_abstractions.length > 0 && (
                                  <div className="mt-1 text-muted-foreground">
                                    Abstractions: <span className="text-foreground">{repo.profile_data.patterns.common_abstractions.join(", ")}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Style */}
                            {repo.profile_data.style_summary && (
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                                  <Settings2 className="h-3 w-3" />
                                  Code Style
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                                  {repo.profile_data.style_summary.indentation && (
                                    <div>Indent: <span className="text-foreground">{repo.profile_data.style_summary.indentation}</span></div>
                                  )}
                                  {repo.profile_data.style_summary.quote_style && (
                                    <div>Quotes: <span className="text-foreground">{repo.profile_data.style_summary.quote_style}</span></div>
                                  )}
                                  {repo.profile_data.style_summary.documentation_style && (
                                    <div>Docs: <span className="text-foreground">{repo.profile_data.style_summary.documentation_style}</span></div>
                                  )}
                                  {repo.profile_data.style_summary.typical_file_length > 0 && (
                                    <div>Avg file: <span className="text-foreground">{repo.profile_data.style_summary.typical_file_length} lines</span></div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Documentation files */}
                            {repo.profile_data.documentation_files && repo.profile_data.documentation_files.length > 0 && (
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                                  <BookOpen className="h-3 w-3" />
                                  Documentation Ingested
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {repo.profile_data.documentation_files.map((doc) => (
                                    <span key={doc.path} className="px-1.5 py-0.5 bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800 rounded">
                                      {doc.path}
                                    </span>
                                  ))}
                                </div>
                                <p className="mt-1 text-muted-foreground">
                                  Content from these files is included in AI review context.
                                </p>
                              </div>
                            )}

                            {/* Config files */}
                            {repo.profile_data.config_files && repo.profile_data.config_files.length > 0 && (
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                                  <Settings2 className="h-3 w-3" />
                                  Config Files Detected
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {repo.profile_data.config_files.map((cfg) => (
                                    <span key={cfg.path} className="px-1.5 py-0.5 bg-background border rounded text-muted-foreground">
                                      {cfg.path}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {analyzingRepo === repo.repo_full_name && (
                      <p className="pl-6 text-xs text-muted-foreground">
                        Scanning files and documentation... AI profiler will run if a provider is configured.
                      </p>
                    )}
                    {!repo.last_analyzed_commit && analyzingRepo !== repo.repo_full_name && (
                      <p className="pl-6 text-xs text-muted-foreground">
                        Profiles your codebase structure, languages, and documentation. If an AI provider is configured, also generates a reviewer's reference guide.
                      </p>
                    )}
                  </div>

                  {/* Generate Embeddings Row */}
                  {(() => {
                    const { label, color, isStale, progress } = getIndexStatusInfo(repo.repo_full_name);
                    const indexStatus = indexStatusQueries.data?.[repo.repo_full_name];
                    const isComplete = indexStatus?.status === "complete";
                    const isFailed = indexStatus?.status === "failed";
                    const isIndexing = !!progress;
                    const hasEmbeddings = embeddingCapability?.available;

                    return (
                      <div className="border-t pt-3 space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {isComplete && !isStale ? (
                              <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                            ) : isFailed ? (
                              <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                            ) : isIndexing ? (
                              <Loader2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
                            ) : (
                              <Database className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            )}
                            <span className={color}>{label}</span>
                          </div>
                          {hasEmbeddings && (
                            <div className="flex items-center gap-1">
                              {isIndexing && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive hover:text-destructive h-8 w-8 p-0"
                                  title="Cancel embedding generation"
                                  onClick={async () => {
                                    await indexing.cancel(repo.repo_full_name);
                                    queryClient.invalidateQueries({ queryKey: ["codebase", "index-status"] });
                                  }}
                                >
                                  <Square className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleIndexRepo(repo.repo_full_name)}
                                disabled={isIndexing || !repo.last_analyzed_commit}
                              >
                                {isIndexing ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Generating...
                                  </>
                                ) : (
                                  <>
                                    <Database className="h-4 w-4 mr-2" />
                                    {isComplete ? "Regenerate" : "Generate Embeddings"}
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Explanatory copy when no embeddings exist yet */}
                        {!isComplete && !isIndexing && !isFailed && (
                          <p className="pl-6 text-xs text-muted-foreground">
                            {hasEmbeddings ? (
                              <>
                                Generates semantic embeddings so AI agents can search your codebase by meaning, not just keywords.
                                Improves review quality but uses API tokens
                                {embeddingCapability?.provider && <> via {embeddingCapability.provider}</>}.
                                {!repo.last_analyzed_commit && " Analyze the repository first."}
                              </>
                            ) : (
                              "Configure an internal agent model in the Agents tab to enable semantic embeddings."
                            )}
                          </p>
                        )}

                        {/* Progress bar during indexing */}
                        {isIndexing && (
                          <div className="space-y-1.5 pl-6">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{progress}</span>
                            </div>
                            {indexStatus && indexStatus.files_total > 0 && (() => {
                              // Two-phase progress: parsing (0-50%) then embedding (50-100%)
                              const ft = indexStatus.files_total;
                              const fp = indexStatus.files_processed;
                              const cp = indexStatus.chunks_processed;
                              const tc = indexStatus.total_chunks;
                              const parsingDone = fp >= ft;

                              let pct: number;
                              if (!parsingDone) {
                                // Phase 1: parsing files (0% to 50%)
                                pct = (fp / ft) * 50;
                              } else if (tc > 0 && cp < tc) {
                                // Phase 2: generating embeddings (50% to 100%)
                                pct = 50 + (cp / tc) * 50;
                              } else if (tc > 0 && cp >= tc) {
                                pct = 100;
                              } else {
                                pct = 50; // parsed but no chunk info yet
                              }

                              return (
                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[200px]">
                                  <div
                                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min(100, pct)}%` }}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* Stats when complete */}
                        {isComplete && indexStatus && (
                          <div className="pl-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {indexStatus.total_chunks} chunks
                            </span>
                            {indexStatus.files_total > 0 && (
                              <span className="flex items-center gap-1">
                                <FileCode className="h-3 w-3" />
                                {indexStatus.files_total} files
                              </span>
                            )}
                            {indexStatus.last_indexed_commit && (
                              <span className="flex items-center gap-1">
                                <GitBranch className="h-3 w-3" />
                                {indexStatus.last_indexed_commit.slice(0, 7)}
                              </span>
                            )}
                            {indexStatus.updated_at && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDistanceToNow(indexStatus.updated_at)}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Error message when failed */}
                        {isFailed && indexStatus?.error_message && (
                          <p className="pl-6 text-xs text-destructive truncate" title={indexStatus.error_message}>
                            {indexStatus.error_message}
                          </p>
                        )}

                        {/* Stale warning */}
                        {isStale && (
                          <p className="pl-6 text-xs text-amber-600 dark:text-amber-400">
                            Embeddings were built on a different commit than the latest analysis. Regenerate for best results.
                          </p>
                        )}

                        {/* Mutation error (error from the Tauri command itself) */}
                        {indexError && repo.repo_full_name === (indexingRepo ?? indexRepoMutation.variables?.repoFullName) && (
                          <p className="pl-6 text-xs text-destructive" title={indexError}>
                            Error: {indexError.length > 120 ? indexError.slice(0, 120) + "..." : indexError}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No repositories linked yet. Link or clone one below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add Repository */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Repository</CardTitle>
          <CardDescription>
            Link an existing local clone or create a new dedicated clone for reviews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="link">
            <TabsList className="mb-4">
              <TabsTrigger value="link" className="flex items-center gap-2">
                <Folder className="h-4 w-4" />
                Link Existing
              </TabsTrigger>
              <TabsTrigger value="clone" className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Clone New
              </TabsTrigger>
            </TabsList>

            <TabsContent value="link">
              <form onSubmit={handleLinkRepo} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="link-repo-name">GitHub Repository</Label>
                  {availableReposToLink && availableReposToLink.length > 0 ? (
                    <select
                      id="link-repo-name"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={linkRepoName}
                      onChange={(e) => setLinkRepoName(e.target.value)}
                      required
                    >
                      <option value="">-- Select a repository --</option>
                      {availableReposToLink.map((repo) => (
                        <option key={repo.id} value={repo.full_name}>
                          {repo.full_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="link-repo-name"
                      type="text"
                      placeholder="owner/repo"
                      value={linkRepoName}
                      onChange={(e) => setLinkRepoName(e.target.value)}
                      required
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="link-local-path">Local Path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="link-local-path"
                      type="text"
                      placeholder="/Users/you/projects/repo"
                      value={linkLocalPath}
                      onChange={(e) => setLinkLocalPath(e.target.value)}
                      required
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleBrowseFolder(setLinkLocalPath)}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Select or enter the path to your local clone
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={linkRepoMutation.isPending || !linkRepoName || !linkLocalPath}
                >
                  {linkRepoMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Linking...
                    </>
                  ) : (
                    "Link Repository"
                  )}
                </Button>

                {linkRepoMutation.isError && (
                  <p className="text-sm text-destructive">
                    {(linkRepoMutation.error as Error).message}
                  </p>
                )}
              </form>
            </TabsContent>

            <TabsContent value="clone">
              <form onSubmit={handleCloneRepo} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="clone-repo-name">GitHub Repository</Label>
                  {availableReposToLink && availableReposToLink.length > 0 ? (
                    <select
                      id="clone-repo-name"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={cloneRepoName}
                      onChange={(e) => setCloneRepoName(e.target.value)}
                      required
                    >
                      <option value="">-- Select a repository --</option>
                      {availableReposToLink.map((repo) => (
                        <option key={repo.id} value={repo.full_name}>
                          {repo.full_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="clone-repo-name"
                      type="text"
                      placeholder="owner/repo"
                      value={cloneRepoName}
                      onChange={(e) => setCloneRepoName(e.target.value)}
                      required
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clone-dest-path">Destination Folder</Label>
                  <div className="flex gap-2">
                    <Input
                      id="clone-dest-path"
                      type="text"
                      placeholder="/Users/you/siftpr-repos"
                      value={cloneDestPath}
                      onChange={(e) => setCloneDestPath(e.target.value)}
                      className="flex-1"
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleBrowseFolder(setCloneDestPath)}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The repository will be cloned into a subfolder at this location
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={cloneRepoMutation.isPending || !cloneRepoName || !cloneDestPath}
                >
                  {cloneRepoMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Cloning...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Clone Repository
                    </>
                  )}
                </Button>

                {cloneRepoMutation.isError && (
                  <p className="text-sm text-destructive">
                    {(cloneRepoMutation.error as Error).message}
                  </p>
                )}
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
