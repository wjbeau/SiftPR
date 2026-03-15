import {
  Loader2,
  Database,
  CheckCircle,
  XCircle,
  FileCode,
  Layers,
  GitBranch,
  Clock,
  Square,
} from "lucide-react";
import { CodebaseIndexStatus, indexing } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "@/lib/utils";

interface RepoIndexingPanelProps {
  repoFullName: string;
  indexStatus: CodebaseIndexStatus | null | undefined;
  isIndexing: boolean;
  indexError: string | null;
  hasEmbeddings: boolean;
  embeddingProvider: string | null | undefined;
  onIndex: (repoFullName: string) => void;
  lastAnalyzedCommit: string | null;
  indexingRepo: string | null;
  indexMutationVariablesRepoName: string | undefined;
  label: string;
  color: string;
  isComplete: boolean;
  isFailed: boolean;
  isStale: boolean;
  progress: string | null;
}

export function RepoIndexingPanel({
  repoFullName,
  indexStatus,
  isIndexing,
  indexError,
  hasEmbeddings,
  embeddingProvider,
  onIndex,
  lastAnalyzedCommit,
  indexingRepo,
  indexMutationVariablesRepoName,
  label,
  color,
  isComplete,
  isFailed,
  isStale,
  progress,
}: RepoIndexingPanelProps) {
  const queryClient = useQueryClient();

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
                  await indexing.cancel(repoFullName);
                  queryClient.invalidateQueries({ queryKey: ["codebase", "index-status"] });
                }}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onIndex(repoFullName)}
              disabled={isIndexing || !lastAnalyzedCommit}
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
              {!lastAnalyzedCommit && " Analyze the repository first."}
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
      {indexError && repoFullName === (indexingRepo ?? indexMutationVariablesRepoName) && (
        <p className="pl-6 text-xs text-destructive" title={indexError}>
          Error: {indexError.length > 120 ? indexError.slice(0, 120) + "..." : indexError}
        </p>
      )}
    </div>
  );
}
