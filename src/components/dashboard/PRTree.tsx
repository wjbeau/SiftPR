import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitBranch, User } from "lucide-react";
import { github, GitHubRepo, GitHubPR } from "@/lib/api";
import { cn, formatDistanceToNow } from "@/lib/utils";

interface PRTreeProps {
  repo: GitHubRepo | null;
}

interface PRNode {
  pr: GitHubPR;
  children: PRNode[];
}

export function PRTree({ repo }: PRTreeProps) {
  const { data: prs, isLoading, error } = useQuery({
    queryKey: ["repo-prs", repo?.owner.login, repo?.name],
    queryFn: () => github.getRepoPRs(repo!.owner.login, repo!.name),
    enabled: !!repo,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  // Build tree structure from PRs
  // A PR is a child of another if its base branch matches the other's head branch
  const { prTree, hasChains } = useMemo(() => {
    if (!prs || prs.length === 0) return { prTree: [], hasChains: false };

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

    // Check if any chains exist
    const hasChains = childPRs.size > 0;

    // Build tree recursively (children already sorted by created_at)
    function buildNode(pr: GitHubPR): PRNode {
      const children = prChildren.get(pr.number) || [];
      return {
        pr,
        children: children.map(buildNode),
      };
    }

    // Root PRs are those not in childPRs (already sorted)
    const roots = sortedPRs.filter((pr) => !childPRs.has(pr.number));
    return { prTree: roots.map(buildNode), hasChains };
  }, [prs]);

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
    <div className="h-full overflow-y-auto">
      <div className="p-4 border-b">
        <h2 className="font-semibold">{repo.full_name}</h2>
        <p className="text-sm text-muted-foreground">
          {prs.length} open pull request{prs.length !== 1 ? "s" : ""}
          {hasChains && (
            <span className="ml-2 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <GitBranch className="h-3 w-3" />
              includes chains
            </span>
          )}
        </p>
      </div>
      <ul className="p-2">
        {prTree.map((node) => (
          <PRNodeItem
            key={node.pr.number}
            node={node}
            depth={0}
            isTreeView={hasChains}
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
}

function PRNodeItem({ node, depth, isTreeView }: PRNodeItemProps) {
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
    <li
      className={cn(depth > 0 && "border-l-4 border-blue-400 dark:border-blue-600")}
      style={{ marginLeft: depth > 0 ? `${depth * 48}px` : 0 }}
    >
      <div
        className={cn(
          "rounded-md hover:bg-accent transition-colors",
          depth > 0 && "bg-muted/30 ml-4"
        )}
      >
        <a
          href={pr.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block py-3 px-3"
        >
          <div className="flex items-start gap-2">
            {/* Collapse button for nodes with children */}
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
        </a>
      </div>
      {hasChildren && isExpanded && (
        <ul className="mt-1">
          {node.children.map((child) => (
            <PRNodeItem
              key={child.pr.number}
              node={child}
              depth={depth + 1}
              isTreeView={isTreeView}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
