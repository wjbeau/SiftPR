import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Calendar, MessageSquare, User, Users, GitPullRequest, CheckCircle2, XCircle } from "lucide-react";
import { github, GitHubFile, GitHubPR, GitHubReview } from "@/lib/api";
import { cn, formatDistanceToNow } from "@/lib/utils";

interface OverviewPanelProps {
  pr: GitHubPR;
  files: GitHubFile[];
  owner: string;
  repo: string;
  prNumber: number;
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

export function OverviewPanel({ pr, files, owner, repo, prNumber }: OverviewPanelProps) {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Fetch reviews for this PR
  const { data: reviews } = useQuery({
    queryKey: ["pr-reviews", owner, repo, prNumber],
    queryFn: () => github.getPRReviews(owner, repo, prNumber),
    staleTime: 1000 * 60 * 2,
  });

  const { approved, changesRequested } = useMemo(() => getReviewSummary(reviews), [reviews]);

  // Collect unique participants (author + assignees)
  const participants = useMemo(() => {
    const users = new Map<string, { login: string; avatar_url: string | null }>();
    users.set(pr.user.login, pr.user);
    pr.assignees?.forEach((a) => {
      if (a && !users.has(a.login)) {
        users.set(a.login, a);
      }
    });
    return Array.from(users.values());
  }, [pr]);

  return (
    <div className="flex gap-8 h-full">
      {/* Left - PR Description */}
      <div className="flex-1 min-w-0">
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-1">Description</h2>
          <p className="text-sm text-muted-foreground">
            {pr.base.ref} ← {pr.head.ref}
          </p>
        </div>

        {pr.body ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{pr.body}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-muted-foreground italic">No description provided.</p>
        )}
      </div>

      {/* Right - Stats Panel */}
      <div className="w-64 flex-shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
          Details
        </h3>

        <div className="space-y-4">
          {/* Author */}
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Author</div>
              <div className="flex items-center gap-2 mt-1">
                {pr.user.avatar_url && (
                  <img
                    src={pr.user.avatar_url}
                    alt={pr.user.login}
                    className="h-5 w-5 rounded-full"
                  />
                )}
                <span className="text-sm font-medium">{pr.user.login}</span>
              </div>
            </div>
          </div>

          {/* Participants */}
          {participants.length > 1 && (
            <div className="flex items-start gap-3">
              <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <div className="text-xs text-muted-foreground">Participants</div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {participants.map((p) => (
                    <div key={p.login} title={p.login}>
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt={p.login}
                          className="h-5 w-5 rounded-full"
                        />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-xs">
                          {p.login[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reviews */}
          {(approved.length > 0 || changesRequested.length > 0) && (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Reviews</div>
                {approved.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Approved</span>
                    </span>
                    <span className="flex -space-x-1">
                      {approved.map((r) => (
                        r.user.avatar_url ? (
                          <img key={r.user.login} src={r.user.avatar_url} alt={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full ring-1 ring-green-200 dark:ring-green-800" />
                        ) : (
                          <span key={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full bg-green-200 dark:bg-green-800 flex items-center justify-center text-[10px] ring-1 ring-green-200 dark:ring-green-800">{r.user.login[0]}</span>
                        )
                      ))}
                    </span>
                  </div>
                )}
                {changesRequested.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1.5">
                      <XCircle className="h-3 w-3" />
                      <span>Changes requested</span>
                    </span>
                    <span className="flex -space-x-1">
                      {changesRequested.map((r) => (
                        r.user.avatar_url ? (
                          <img key={r.user.login} src={r.user.avatar_url} alt={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full ring-1 ring-red-200 dark:ring-red-800" />
                        ) : (
                          <span key={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center text-[10px] ring-1 ring-red-200 dark:ring-red-800">{r.user.login[0]}</span>
                        )
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Date Opened */}
          <div className="flex items-start gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Opened</div>
              <div className="text-sm">{formatDistanceToNow(pr.created_at)}</div>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-start gap-3">
            <GitPullRequest className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="text-sm flex items-center gap-2">
                <span className={cn(
                  "capitalize",
                  pr.state === "open" && "text-green-600",
                  pr.state === "closed" && "text-red-600",
                  pr.state === "merged" && "text-purple-600"
                )}>
                  {pr.draft ? "Draft" : pr.state}
                </span>
              </div>
            </div>
          </div>

          {/* Comments */}
          {(pr.comments !== null || pr.review_comments !== null) && (
            <div className="flex items-start gap-3">
              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <div className="text-xs text-muted-foreground">Comments</div>
                <div className="text-sm">
                  {(pr.comments || 0) + (pr.review_comments || 0)} total
                </div>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Changes
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">Files</div>
                <div className="text-lg font-semibold">{files.length}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">Lines</div>
                <div className="text-lg font-semibold">
                  {totalAdditions + totalDeletions}
                </div>
              </div>
            </div>

            <div className="mt-3 p-3 bg-muted rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-green-600 font-medium">+{totalAdditions}</span>
                <span className="text-red-600 font-medium">-{totalDeletions}</span>
              </div>
              <div className="mt-2 h-2 bg-background rounded-full overflow-hidden flex">
                <div
                  className="bg-green-500 h-full"
                  style={{
                    width: `${(totalAdditions / (totalAdditions + totalDeletions || 1)) * 100}%`,
                  }}
                />
                <div
                  className="bg-red-500 h-full"
                  style={{
                    width: `${(totalDeletions / (totalAdditions + totalDeletions || 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
