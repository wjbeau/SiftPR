import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agents, codebase, github, indexing, CodebaseIndexStatus } from "@/lib/api";
import { logger } from "@/lib/logger";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertTriangle,
  FolderGit,
} from "lucide-react";
import { LinkRepoForm } from "./LinkRepoForm";
import { LinkedRepoCard } from "./LinkedRepoCard";

export function Repositories() {
  const queryClient = useQueryClient();
  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);
  const [indexingRepo, setIndexingRepo] = useState<string | null>(null);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

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

  const handleUnlinkRepo = (repoFullName: string) => {
    unlinkRepoMutation.mutate(repoFullName);
  };

  const handleToggleProfile = (repoFullName: string) => {
    setExpandedProfile(expandedProfile === repoFullName ? null : repoFullName);
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
                <LinkedRepoCard
                  key={repo.id}
                  repo={repo}
                  indexStatus={indexStatusQueries.data?.[repo.repo_full_name]}
                  analyzingRepo={analyzingRepo}
                  indexingRepo={indexingRepo}
                  indexError={indexError}
                  indexMutationVariablesRepoName={indexRepoMutation.variables?.repoFullName}
                  expandedProfile={expandedProfile}
                  hasEmbeddings={!!embeddingCapability?.available}
                  embeddingProvider={embeddingCapability?.provider}
                  onAnalyze={handleAnalyzeRepo}
                  onIndex={handleIndexRepo}
                  onUnlink={handleUnlinkRepo}
                  onToggleProfile={handleToggleProfile}
                />
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
          <LinkRepoForm availableRepos={availableReposToLink} />
        </CardContent>
      </Card>
    </div>
  );
}
