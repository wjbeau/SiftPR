import { MessageCircle, MessageSquare, Filter, History, Trash2 } from "lucide-react";
import { draftComments } from "@/lib/api";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GitHubFile } from "@/lib/api";
import type { PendingComment, ViewMode } from "@/lib/types/review";

interface ReviewActionsBarProps {
  viewedFiles: Set<string>;
  displayFiles: GitHubFile[];
  pendingComments: PendingComment[];
  setPendingComments: (comments: PendingComment[]) => void;
  setReviewBody: (body: string) => void;
  hasReviewedBefore: boolean;
  hasNewChanges: boolean;
  filesSinceReview: GitHubFile[] | undefined;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  setShowReviewDialog: (show: boolean) => void;
  isSubmittingReview: boolean;
  owner: string | undefined;
  repo: string | undefined;
  prNumberInt: number;
}

export function ReviewActionsBar({
  viewedFiles,
  displayFiles,
  pendingComments,
  setPendingComments,
  setReviewBody,
  hasReviewedBefore,
  hasNewChanges,
  filesSinceReview,
  viewMode,
  setViewMode,
  setShowReviewDialog,
  isSubmittingReview,
  owner,
  repo,
  prNumberInt,
}: ReviewActionsBarProps) {
  return (
    <div className="border-b px-4 py-2 flex items-center justify-between bg-muted/30 flex-shrink-0">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {viewedFiles.size} of {displayFiles.length} files viewed
        </span>
        {pendingComments.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" />
              {pendingComments.length} pending comment{pendingComments.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={() => {
                if (!window.confirm(`Discard ${pendingComments.length} pending comment${pendingComments.length !== 1 ? "s" : ""} and review body?`)) return;
                if (owner && repo && prNumberInt) {
                  draftComments.clear(owner, repo, prNumberInt).catch((err) =>
                    logger.error("Failed to clear draft comments:", err)
                  );
                }
                setPendingComments([]);
                setReviewBody("");
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive border border-transparent hover:border-destructive/30 rounded px-1.5 py-0.5 transition-colors"
              title="Discard all pending comments"
            >
              <Trash2 className="h-3 w-3" />
              Discard
            </button>
          </div>
        )}
        {hasReviewedBefore && (
          <div className="flex items-center border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode("all")}
              className={cn(
                "px-2.5 py-1 text-xs flex items-center gap-1.5 transition-colors",
                viewMode === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              )}
            >
              <Filter className="h-3 w-3" />
              All
            </button>
            <button
              onClick={() => setViewMode("since_review")}
              className={cn(
                "px-2.5 py-1 text-xs flex items-center gap-1.5 transition-colors",
                viewMode === "since_review" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                hasNewChanges && viewMode !== "since_review" && "text-amber-600"
              )}
            >
              <History className="h-3 w-3" />
              New
              {hasNewChanges && filesSinceReview && (
                <span className="bg-amber-500 text-white text-[10px] px-1 rounded-full">{filesSinceReview.length}</span>
              )}
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowReviewDialog(true)}
          disabled={isSubmittingReview}
          className="gap-1.5"
        >
          <MessageSquare className="h-4 w-4" />
          Submit Review
        </Button>
      </div>
    </div>
  );
}
