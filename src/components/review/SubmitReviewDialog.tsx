import { Loader2, MessageSquare, CheckCircle2, XCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PendingComment, ReviewAction } from "@/lib/types/review";

interface SubmitReviewDialogProps {
  showReviewDialog: boolean;
  setShowReviewDialog: (show: boolean) => void;
  pendingComments: PendingComment[];
  reviewBody: string;
  setReviewBody: (body: string) => void;
  submitError: string | null;
  isSubmittingReview: boolean;
  submitReview: (action: ReviewAction) => void;
  userLogin: string | undefined;
  prAuthorLogin: string | undefined;
}

export function SubmitReviewDialog({
  showReviewDialog,
  setShowReviewDialog,
  pendingComments,
  reviewBody,
  setReviewBody,
  submitError,
  isSubmittingReview,
  submitReview,
  userLogin,
  prAuthorLogin,
}: SubmitReviewDialogProps) {
  if (!showReviewDialog) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowReviewDialog(false)}>
      <div className="bg-background border rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">Submit Review</h3>
          <button onClick={() => setShowReviewDialog(false)} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 flex-1 overflow-auto">
          {pendingComments.length > 0 && (
            <div className="mb-3">
              <p className="text-sm text-muted-foreground mb-2">
                {pendingComments.length} inline comment{pendingComments.length !== 1 ? "s" : ""} will be included
              </p>
              <div className="max-h-32 overflow-auto border rounded p-2 space-y-1.5">
                {pendingComments.map((c, i) => (
                  <div key={i} className="text-xs">
                    <span className="font-mono text-muted-foreground">{c.file.split("/").pop()}</span>
                    {c.newLineNum && <span className="text-muted-foreground">:{c.newLineNum}</span>}
                    <span className="text-muted-foreground"> — </span>
                    <span className="truncate">{c.body.length > 80 ? c.body.slice(0, 80) + "…" : c.body}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="text-sm font-medium">Review summary</label>
          <textarea
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            placeholder="Leave a comment on this pull request…"
            className="w-full mt-1.5 p-2 text-sm bg-background border rounded resize-none focus:ring-2 focus:ring-ring focus:outline-none"
            rows={5}
            autoFocus
          />

          {submitError && (
            <p className="text-xs text-destructive mt-2">{submitError}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              submitReview("comment");
            }}
            disabled={isSubmittingReview || (!reviewBody.trim() && pendingComments.length === 0)}
            className="gap-1.5"
          >
            {isSubmittingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            Comment
          </Button>
          {userLogin !== prAuthorLogin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => submitReview("approve")}
                disabled={isSubmittingReview}
                className="gap-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
              >
                {isSubmittingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => submitReview("request_changes")}
                disabled={isSubmittingReview || !reviewBody.trim()}
                className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                {isSubmittingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Request Changes
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
