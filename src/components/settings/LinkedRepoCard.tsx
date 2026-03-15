import { LinkedRepo, CodebaseIndexStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Folder,
  Trash2,
  GitBranch,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { RepoProfilePanel } from "./RepoProfilePanel";
import { RepoIndexingPanel } from "./RepoIndexingPanel";

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
          <RepoProfilePanel
            profileData={repo.profile_data}
            aiSummary={repo.ai_summary}
            isAnalyzing={analyzingRepo === repo.repo_full_name}
            isExpanded={expandedProfile === repo.repo_full_name}
            onToggle={() => onToggleProfile(repo.repo_full_name)}
          />
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
      <RepoIndexingPanel
        repoFullName={repo.repo_full_name}
        indexStatus={indexStatus}
        isIndexing={isIndexing}
        indexError={indexError}
        hasEmbeddings={hasEmbeddings}
        embeddingProvider={embeddingProvider}
        onIndex={onIndex}
        lastAnalyzedCommit={repo.last_analyzed_commit}
        indexingRepo={indexingRepo}
        indexMutationVariablesRepoName={indexMutationVariablesRepoName}
        label={label}
        color={color}
        isComplete={isComplete}
        isFailed={isFailed}
        isStale={isStale}
        progress={progress}
      />
    </div>
  );
}
