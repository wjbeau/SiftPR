import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitBranch, User, Loader2, RefreshCw } from "lucide-react";
import { github } from "@/lib/api";
import type { GitHubRepo, GitHubPR } from "@/lib/api";
import { cn, formatDistanceToNow } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useTabs } from "@/contexts/TabsContext";

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

interface PRNode {
  pr: GitHubPR;
  children: PRNode[];
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

  const handleRefresh = () => {
    refetch();
    if (prNumbers.length > 0) {
      refetchReviews();
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
            <PRList prs={activeReviews} owner={repo.owner.login} repoName={repo.name} />
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
            <PRList prs={openPRs} owner={repo.owner.login} repoName={repo.name} />
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
}

function PRList({ prs, owner, repoName }: PRListProps) {
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
          />
        ))}
      </ul>
    </div>
  );
}

interface PRNodeItemProps {
  node: PRNode;
  depth: number;
  isTreeView: boolean;
  owner: string;
  repoName: string;
}

function PRNodeItem({ node, depth, isTreeView, owner, repoName }: PRNodeItemProps) {
  const { pr } = node;
  const { openTab } = useTabs();
  const hasChildren = node.children.length > 0;
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleOpenPR = () => {
    openTab({
      title: `#${pr.number} ${pr.title}`,
      type: "pr",
      path: `/review/${owner}/${repoName}/${pr.number}`,
      prInfo: {
        owner,
        repo: repoName,
        number: pr.number,
      },
    });
  };

  const assignees = pr.assignees?.filter(Boolean) || [];

  return (
    <li className={cn(depth > 0 && "ml-4 pl-3 border-l-2 border-blue-400 dark:border-blue-600")}>
      <div
        className={cn(
          "rounded-md hover:bg-accent transition-colors cursor-pointer",
          depth > 0 && "bg-muted/30"
        )}
        onClick={handleOpenPR}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleOpenPR();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="block py-3 px-3">
          <div className="flex items-start gap-2">
            {hasChildren && isTreeView ? (
              <button
                type="button"
                onClick={toggleExpand}
                className="mt-0.5 p-0.5 hover:bg-muted rounded transition-colors flex-shrink-0"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90"
                  )}
                />
              </button>
            ) : isTreeView && depth === 0 ? (
              <div className="w-5 flex-shrink-0" />
            ) : null}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">#{pr.number}</span>
                {pr.draft && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                    Draft
                  </span>
                )}
                {hasChildren && (
                  <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {node.children.length} dependent
                  </span>
                )}
                {depth > 0 && (
                  <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 px-1.5 py-0.5 rounded">
                    stacked
                  </span>
                )}
              </div>
              <h3 className="font-medium text-sm mt-0.5 line-clamp-2">{pr.title}</h3>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  {pr.user.avatar_url && (
                    <img
                      src={pr.user.avatar_url}
                      alt={pr.user.login}
                      className="h-4 w-4 rounded-full"
                    />
                  )}
                  {pr.user.login}
                </span>
                <span>{formatDistanceToNow(pr.created_at)}</span>
                {assignees.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    <span className="flex items-center gap-0.5">
                      {assignees.slice(0, 3).map((assignee, i) => (
                        <span key={assignee.login} className="flex items-center">
                          {assignee.avatar_url ? (
                            <img
                              src={assignee.avatar_url}
                              alt={assignee.login}
                              className="h-4 w-4 rounded-full"
                              title={assignee.login}
                            />
                          ) : (
                            <span>{assignee.login}</span>
                          )}
                          {i < Math.min(assignees.length, 3) - 1 && <span>,</span>}
                        </span>
                      ))}
                      {assignees.length > 3 && (
                        <span className="text-muted-foreground">+{assignees.length - 3}</span>
                      )}
                    </span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground/50">
                    <User className="h-3 w-3" />
                    unassigned
                  </span>
                )}
                <span className="text-muted-foreground/60">
                  {pr.base.ref} ← {pr.head.ref}
                </span>
              </div>
              {(pr.additions !== null || pr.deletions !== null) && (
                <div className="flex items-center gap-2 mt-1 text-xs">
                  {pr.additions !== null && (
                    <span className="text-green-600 dark:text-green-400">
                      +{pr.additions}
                    </span>
                  )}
                  {pr.deletions !== null && (
                    <span className="text-red-600 dark:text-red-400">
                      -{pr.deletions}
                    </span>
                  )}
                  {pr.changed_files !== null && (
                    <span className="text-muted-foreground">
                      {pr.changed_files} file{pr.changed_files !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <ul className="mt-1">
          {node.children.map((child) => (
            <PRNodeItem
              key={child.pr.number}
              node={child}
              depth={depth + 1}
              isTreeView={isTreeView}
              owner={owner}
              repoName={repoName}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
