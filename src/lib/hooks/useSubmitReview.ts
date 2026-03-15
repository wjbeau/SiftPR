import { useState, useCallback } from "react";
import { github, GitHubPR, ReviewComment, draftComments, review } from "@/lib/api";
import { logger } from "@/lib/logger";
import type { PendingComment, ReviewAction } from "@/lib/types/review";

export function useSubmitReview(
  owner: string | undefined,
  repo: string | undefined,
  prNumber: number,
  pr: GitHubPR | undefined,
  viewedFiles: Set<string>,
  pendingComments: PendingComment[],
  setPendingComments: React.Dispatch<React.SetStateAction<PendingComment[]>>
) {
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewBody, setReviewBody] = useState("");

  const submitReview = useCallback(async (action: ReviewAction) => {
    if (!owner || !repo || !prNumber) return;

    setIsSubmittingReview(true);
    setSubmitError(null);

    try {
      // Convert action to GitHub event format
      const event = action === "approve"
        ? "APPROVE"
        : action === "request_changes"
        ? "REQUEST_CHANGES"
        : "COMMENT";

      // Convert pending comments to GitHub format using actual line numbers
      const comments: ReviewComment[] = pendingComments.map((c) => {
        const line = c.newLineNum ?? null;
        const side = line ? ("RIGHT" as const) : null;
        const isMultiLine = c.newLineNumStart != null && line != null && c.newLineNumStart !== line;
        return {
          path: c.file,
          line,
          side,
          start_line: isMultiLine ? c.newLineNumStart : undefined,
          start_side: isMultiLine ? side : undefined,
          body: c.body,
        };
      });

      // Submit the review to GitHub
      await github.submitReview(
        owner,
        repo,
        prNumber,
        event,
        reviewBody,
        comments
      );

      // Save the review state (mark current commit as reviewed)
      if (pr?.head.sha) {
        try {
          await review.saveState(
            owner,
            repo,
            prNumber,
            pr.head.sha,
            Array.from(viewedFiles)
          );
        } catch (e) {
          logger.error("Failed to save review state:", e);
        }
      }

      // Clear drafts from DB then clear form
      draftComments.clear(owner, repo, prNumber).catch((err) =>
        logger.error("Failed to clear draft comments:", err)
      );
      setPendingComments([]);
      setReviewBody("");
      setShowReviewDialog(false);
    } catch (e) {
      logger.error("Failed to submit review:", e);
      const errorMsg = typeof e === "string"
        ? e
        : (e as { message?: string })?.message || "Failed to submit review";
      setSubmitError(errorMsg);
    } finally {
      setIsSubmittingReview(false);
    }
  }, [reviewBody, pendingComments, owner, repo, prNumber, pr?.head.sha, viewedFiles, setPendingComments]);

  return { isSubmittingReview, submitError, showReviewDialog, setShowReviewDialog, reviewBody, setReviewBody, submitReview };
}
