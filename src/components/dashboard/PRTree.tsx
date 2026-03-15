import { useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Loader2, RefreshCw } from "lucide-react";
import { github } from "@/lib/api";
import type { GitHubRepo, GitHubPR, GitHubReview } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PRNodeItem } from "./PRListItem";
import type { PRNode } from "./PRListItem";

const STORAGE_KEY_PRS_PREFIX = "siftpr-cached-prs-";

// Load cached PRs from localStorage
function getCachedPRs(owner: string, repo: string): GitHubPR[] | undefined {
  try {
    const cached = localStorage.getItem(`${STORAGE_KEY_PRS_PREFIX}${owner}/${repo}`);
    return cached ? JSON.parse(cached) : undefined;
  } catch {
    return undefined;
  }
}

interface PRPanelProps {
  repo: GitHubRepo | null;
}

export function PRPanel({ repo }: PRPanelProps) {
  const { data: prs, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["repo-prs", repo?.owner.login, repo?.name],
    queryFn: () => {
      if (!repo) throw new Error("No repo selected");
      return github.getRepoPRs(repo.owner.login, repo.name);
    },
    enabled: !!repo,
    staleTime: 1000 * 60 * 2, // 2 minutes
    placeholderData: repo ? () => getCachedPRs(repo.owner.login, repo.name) : undefined,
  });

  // Cache PRs to localStorage when they change
  useEffect(() => {
    if (repo && prs && prs.length > 0) {
      localStorage.setItem(
        `${STORAGE_KEY_PRS_PREFIX}${repo.owner.login}/${repo.name}`,
        JSON.stringify(prs)
      );
    }
  }, [repo, prs]);

  // Get PR numbers for checking user reviews
  const prNumbers = useMemo(() => prs?.map((pr) => pr.number) || [], [prs]);

  const { data: reviewedPRNumbers = [], isLoading: isLoadingReviews, isFetching: isFetchingReviews, refetch: refetchReviews } = useQuery({
    queryKey: ["user-reviewed-prs", repo?.owner.login, repo?.name, prNumbers],
    queryFn: () => {
      if (!repo) throw new Error("No repo selected");
      return github.getUserReviewedPRs(repo.owner.login, repo.name, prNumbers);
    },
    enabled: !!repo && prNumbers.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Fetch reviews for all PRs to show approval/changes requested status
  const { data: prsReviews = {}, refetch: refetchPRsReviews } = useQuery({
    queryKey: ["prs-reviews", repo?.owner.login, repo?.name, prNumbers],
    queryFn: () => {
      if (!repo) throw new Error("No repo selected");
      return github.getPRsReviews(repo.owner.login, repo.name, prNumbers);
    },
    enabled: !!repo && prNumbers.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  const handleRefresh = () => {
    refetch();
    if (prNumbers.length > 0) {
      refetchReviews();
      refetchPRsReviews();
    }
  };

  const isRefreshing = isFetching || isFetchingReviews;

  // Split PRs into active reviews and open PRs
  const { activeReviews, openPRs } = useMemo(() => {
    if (!prs) return { activeReviews: [], openPRs: [] };
    const reviewedSet = new Set(reviewedPRNumbers);
    return {
      activeReviews: prs.filter((pr) => reviewedSet.has(pr.number)),
      openPRs: prs.filter((pr) => !reviewedSet.has(pr.number)),
    };
  }, [prs, reviewedPRNumbers]);

  if (!repo) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a repository to view pull requests
      </div>
    );
  }

  // Only show loading state on initial load (no cached data)
  const showLoading = isLoading && !prs;

  if (showLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold">{repo.full_name}</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading pull requests...
          </p>
        </div>
        <div className="p-4 space-y-3">
          {/* Skeleton PR items */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-4 w-12 bg-muted rounded" />
                    <div className="h-4 w-16 bg-muted rounded" />
                  </div>
                  <div className="h-5 w-3/4 bg-muted rounded mb-2" />
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 bg-muted rounded-full" />
                    <div className="h-3 w-20 bg-muted rounded" />
                    <div className="h-3 w-16 bg-muted rounded" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !prs) {
    return (
      <div className="p-4">
        <div className="text-sm text-destructive">Failed to load pull requests</div>
      </div>
    );
  }

  if (!prs || prs.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b flex items-start justify-between">
          <div>
            <h2 className="font-semibold">{repo.full_name}</h2>
            <p className="text-sm text-muted-foreground">
              {isRefreshing ? "Refreshing..." : "No open pull requests"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh pull requests"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {!isRefreshing && (
          <div className="flex items-center justify-center flex-1 text-muted-foreground">
            No open pull requests
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-start justify-between">
        <div>
          <h2 className="font-semibold">{repo.full_name}</h2>
          <p className="text-sm text-muted-foreground">
            {isRefreshing ? "Refreshing..." : `${prs.length} open pull request${prs.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh pull requests"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Tabs defaultValue="active" className="flex-1 flex flex-col">
        <div className="px-4 pt-2">
          <TabsList className="w-full">
            <TabsTrigger value="active" className="flex-1">
              Active Reviews
              {isLoadingReviews ? (
                <Loader2 className="ml-1.5 h-3 w-3 animate-spin" />
              ) : activeReviews.length > 0 ? (
                <span className="ml-1.5 bg-primary/20 text-primary px-1.5 py-0.5 rounded-full text-xs">
                  {activeReviews.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="open" className="flex-1">
              Open PRs
              {isLoadingReviews ? (
                <Loader2 className="ml-1.5 h-3 w-3 animate-spin" />
              ) : openPRs.length > 0 ? (
                <span className="ml-1.5 bg-muted px-1.5 py-0.5 rounded-full text-xs">
                  {openPRs.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="active" className="flex-1 overflow-y-auto mt-0">
          {isLoadingReviews ? (
            <div className="p-4 space-y-3">
              {[1, 2].map((i) => (
                <PRSkeleton key={i} />
              ))}
            </div>
          ) : activeReviews.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No PRs where you've reviewed or commented
            </div>
          ) : (
            <PRList prs={activeReviews} owner={repo.owner.login} repoName={repo.name} prsReviews={prsReviews} />
          )}
        </TabsContent>

        <TabsContent value="open" className="flex-1 overflow-y-auto mt-0">
          {isLoadingReviews ? (
            <div className="p-4 space-y-3">
              {[1, 2].map((i) => (
                <PRSkeleton key={i} />
              ))}
            </div>
          ) : openPRs.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              All open PRs have your reviews
            </div>
          ) : (
            <PRList prs={openPRs} owner={repo.owner.login} repoName={repo.name} prsReviews={prsReviews} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Keep the old export name for backwards compatibility
export { PRPanel as PRTree };

function PRSkeleton() {
  return (
    <div className="animate-pulse rounded-md p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-4 w-12 bg-muted rounded" />
            <div className="h-4 w-16 bg-muted rounded" />
          </div>
          <div className="h-5 w-3/4 bg-muted rounded mb-2" />
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 bg-muted rounded-full" />
            <div className="h-3 w-20 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface PRListProps {
  prs: GitHubPR[];
  owner: string;
  repoName: string;
  prsReviews: Record<number, GitHubReview[]>;
}

function PRList({ prs, owner, repoName, prsReviews }: PRListProps) {
  // Build tree structure from PRs
  const { prTree, hasChains } = useMemo(() => {
    if (prs.length === 0) return { prTree: [], hasChains: false };

    // Sort PRs by created_at ascending (oldest first)
    const sortedPRs = [...prs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Create a map of head branch -> PR
    const headBranchMap = new Map<string, GitHubPR>();
    for (const pr of sortedPRs) {
      headBranchMap.set(pr.head.ref, pr);
    }

    // Find parent/child relationships
    const childPRs = new Set<number>();
    const prChildren = new Map<number, GitHubPR[]>();

    for (const pr of sortedPRs) {
      const parentPR = headBranchMap.get(pr.base.ref);
      if (parentPR && parentPR.number !== pr.number) {
        childPRs.add(pr.number);
        const children = prChildren.get(parentPR.number) || [];
        children.push(pr);
        prChildren.set(parentPR.number, children);
      }
    }

    const hasChains = childPRs.size > 0;

    function buildNode(pr: GitHubPR): PRNode {
      const children = prChildren.get(pr.number) || [];
      return {
        pr,
        children: children.map(buildNode),
      };
    }

    const roots = sortedPRs.filter((pr) => !childPRs.has(pr.number));
    return { prTree: roots.map(buildNode), hasChains };
  }, [prs]);

  return (
    <div className="p-2">
      {hasChains && (
        <div className="px-2 pb-2 text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          includes stacked PRs
        </div>
      )}
      <ul>
        {prTree.map((node) => (
          <PRNodeItem
            key={node.pr.number}
            node={node}
            depth={0}
            isTreeView={hasChains}
            owner={owner}
            repoName={repoName}
            prsReviews={prsReviews}
          />
        ))}
      </ul>
    </div>
  );
}
