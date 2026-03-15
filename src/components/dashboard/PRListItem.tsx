import { useState, useMemo } from "react";
import { ChevronRight, GitBranch, User, CheckCircle2, XCircle } from "lucide-react";
import type { GitHubPR, GitHubReview } from "@/lib/api";
import { cn, formatDistanceToNow } from "@/lib/utils";
import { useTabs } from "@/contexts/TabsContext";

export interface PRNode {
  pr: GitHubPR;
  children: PRNode[];
}

export interface PRNodeItemProps {
  node: PRNode;
  depth: number;
  isTreeView: boolean;
  owner: string;
  repoName: string;
  prsReviews: Record<number, GitHubReview[]>;
}

// Get the latest review state per user (only APPROVED or CHANGES_REQUESTED count)
export function getReviewSummary(reviews: GitHubReview[] | undefined) {
  if (!reviews || reviews.length === 0) return { approved: [], changesRequested: [] };

  // Get the latest review per user
  const latestByUser = new Map<string, GitHubReview>();
  for (const review of reviews) {
    if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED") {
      const existing = latestByUser.get(review.user.login);
      if (!existing || (review.submitted_at && existing.submitted_at && review.submitted_at > existing.submitted_at)) {
        latestByUser.set(review.user.login, review);
      }
    }
  }

  const approved: GitHubReview[] = [];
  const changesRequested: GitHubReview[] = [];

  for (const review of latestByUser.values()) {
    if (review.state === "APPROVED") {
      approved.push(review);
    } else if (review.state === "CHANGES_REQUESTED") {
      changesRequested.push(review);
    }
  }

  return { approved, changesRequested };
}

export function PRNodeItem({ node, depth, isTreeView, owner, repoName, prsReviews }: PRNodeItemProps) {
  const { pr } = node;
  const { openTab } = useTabs();
  const hasChildren = node.children.length > 0;
  const [isExpanded, setIsExpanded] = useState(true);

  const reviews = prsReviews[pr.number];
  const { approved, changesRequested } = useMemo(() => getReviewSummary(reviews), [reviews]);

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
                {/* Review status badges */}
                {changesRequested.length > 0 && (
                  <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1.5" title={`Changes requested by: ${changesRequested.map(r => r.user.login).join(", ")}`}>
                    <XCircle className="h-3 w-3" />
                    <span>Changes requested</span>
                    <span className="flex -space-x-1">
                      {changesRequested.slice(0, 3).map((r) => (
                        r.user.avatar_url ? (
                          <img key={r.user.login} src={r.user.avatar_url} alt={r.user.login} className="h-4 w-4 rounded-full ring-1 ring-red-200 dark:ring-red-800" />
                        ) : (
                          <span key={r.user.login} className="h-4 w-4 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center text-[8px]">{r.user.login[0]}</span>
                        )
                      ))}
                      {changesRequested.length > 3 && (
                        <span className="h-4 w-4 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center text-[8px] ring-1 ring-red-200 dark:ring-red-800">+{changesRequested.length - 3}</span>
                      )}
                    </span>
                  </span>
                )}
                {approved.length > 0 && (
                  <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1.5" title={`Approved by: ${approved.map(r => r.user.login).join(", ")}`}>
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Approved</span>
                    <span className="flex -space-x-1">
                      {approved.slice(0, 3).map((r) => (
                        r.user.avatar_url ? (
                          <img key={r.user.login} src={r.user.avatar_url} alt={r.user.login} className="h-4 w-4 rounded-full ring-1 ring-green-200 dark:ring-green-800" />
                        ) : (
                          <span key={r.user.login} className="h-4 w-4 rounded-full bg-green-200 dark:bg-green-800 flex items-center justify-center text-[8px]">{r.user.login[0]}</span>
                        )
                      ))}
                      {approved.length > 3 && (
                        <span className="h-4 w-4 rounded-full bg-green-200 dark:bg-green-800 flex items-center justify-center text-[8px] ring-1 ring-green-200 dark:ring-green-800">+{approved.length - 3}</span>
                      )}
                    </span>
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
              prsReviews={prsReviews}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
