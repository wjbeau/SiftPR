import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight, GitBranch, User } from "lucide-react";
import { github, GitHubRepo, GitHubPR } from "@/lib/api";
import { cn, formatDistanceToNow } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PRPanelProps {
  repo: GitHubRepo | null;
}

interface PRNode {
  pr: GitHubPR;
  children: PRNode[];
}

export function PRPanel({ repo }: PRPanelProps) {
  const { data: prs, isLoading, error } = useQuery({
    queryKey: ["repo-prs", repo?.owner.login, repo?.name],
    queryFn: () => github.getRepoPRs(repo!.owner.login, repo!.name),
    enabled: !!repo,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  // Get PR numbers for checking user reviews
  const prNumbers = useMemo(() => prs?.map((pr) => pr.number) || [], [prs]);

  const { data: reviewedPRNumbers = [] } = useQuery({
    queryKey: ["user-reviewed-prs", repo?.owner.login, repo?.name, prNumbers],
    queryFn: () =>
      github.getUserReviewedPRs(repo!.owner.login, repo!.name, prNumbers),
    enabled: !!repo && prNumbers.length > 0,
    staleTime: 1000 * 60 * 2,
  });

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

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="text-sm text-muted-foreground">Loading pull requests...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-sm text-destructive">Failed to load pull requests</div>
      </div>
    );
  }

  if (!prs || prs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No open pull requests
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="font-semibold">{repo.full_name}</h2>
        <p className="text-sm text-muted-foreground">
          {prs.length} open pull request{prs.length !== 1 ? "s" : ""}
        </p>
      </div>

      <Tabs defaultValue="active" className="flex-1 flex flex-col">
        <div className="px-4 pt-2">
          <TabsList className="w-full">
            <TabsTrigger value="active" className="flex-1">
              Active Reviews
              {activeReviews.length > 0 && (
                <span className="ml-1.5 bg-primary/20 text-primary px-1.5 py-0.5 rounded-full text-xs">
                  {activeReviews.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="open" className="flex-1">
              Open PRs
              {openPRs.length > 0 && (
                <span className="ml-1.5 bg-muted px-1.5 py-0.5 rounded-full text-xs">
                  {openPRs.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="active" className="flex-1 overflow-y-auto mt-0">
          {activeReviews.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No PRs where you've reviewed or commented
            </div>
          ) : (
            <PRList prs={activeReviews} owner={repo!.owner.login} repoName={repo!.name} />
          )}
        </TabsContent>

        <TabsContent value="open" className="flex-1 overflow-y-auto mt-0">
          {openPRs.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              All open PRs have your reviews
            </div>
          ) : (
            <PRList prs={openPRs} owner={repo!.owner.login} repoName={repo!.name} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Keep the old export name for backwards compatibility
export { PRPanel as PRTree };

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
  const hasChildren = node.children.length > 0;
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const assignees = pr.assignees?.filter(Boolean) || [];

  return (
    <li className={cn(depth > 0 && "ml-4 pl-3 border-l-2 border-blue-400 dark:border-blue-600")}>
      <div
        className={cn(
          "rounded-md hover:bg-accent transition-colors",
          depth > 0 && "bg-muted/30"
        )}
      >
        <Link
          to={`/review/${owner}/${repoName}/${pr.number}`}
          className="block py-3 px-3"
        >
          <div className="flex items-start gap-2">
            {hasChildren && isTreeView ? (
              <button
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
        </Link>
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
