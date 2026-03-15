import { LinkedRepo, CodebaseIndexStatus, indexing } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Folder,
  Trash2,
  GitBranch,
  Clock,
  RefreshCw,
  Loader2,
  AlertTriangle,
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

interface LinkedRepoCardProps {
  repo: LinkedRepo;
  indexStatus: CodebaseIndexStatus | null | undefined;
  analyzingRepo: string | null;
  indexingRepo: string | null;
  indexError: string | null;
  indexMutationVariablesRepoName: string | undefined;
  expandedProfile: string | null;
  hasEmbeddings: boolean;
  embeddingProvider: string | null | undefined;
  onAnalyze: (repoFullName: string) => void;
  onIndex: (repoFullName: string) => void;
  onUnlink: (repoFullName: string) => void;
  onToggleProfile: (repoFullName: string) => void;
}

function getIndexStatusInfo(
  repoFullName: string,
  indexStatus: CodebaseIndexStatus | null | undefined,
  indexingRepo: string | null,
  lastAnalyzedCommit: string | null,
): { label: string; color: string; isStale: boolean; progress: string | null } {
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
    const isStale = lastAnalyzedCommit &&
      indexStatus.last_indexed_commit !== lastAnalyzedCommit;

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
}

export function LinkedRepoCard({
  repo,
  indexStatus,
  analyzingRepo,
  indexingRepo,
  indexError,
  indexMutationVariablesRepoName,
  expandedProfile,
  hasEmbeddings,
  embeddingProvider,
  onAnalyze,
  onIndex,
  onUnlink,
  onToggleProfile,
}: LinkedRepoCardProps) {
  const queryClient = useQueryClient();
  const { label, color, isStale, progress } = getIndexStatusInfo(
    repo.repo_full_name,
    indexStatus,
    indexingRepo,
    repo.last_analyzed_commit,
  );
  const isComplete = indexStatus?.status === "complete";
  const isFailed = indexStatus?.status === "failed";
  const isIndexing = !!progress;

  return (
    <div className="p-4 border rounded-lg space-y-3">
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
          onClick={() => onUnlink(repo.repo_full_name)}
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
            onClick={() => onAnalyze(repo.repo_full_name)}
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
                onClick={() => onToggleProfile(repo.repo_full_name)}
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
                onClick={() => onIndex(repo.repo_full_name)}
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
                {embeddingProvider && <> via {embeddingProvider}</>}.
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
        {indexError && repo.repo_full_name === (indexingRepo ?? indexMutationVariablesRepoName) && (
          <p className="pl-6 text-xs text-destructive" title={indexError}>
            Error: {indexError.length > 120 ? indexError.slice(0, 120) + "..." : indexError}
          </p>
        )}
      </div>
    </div>
  );
}
