import { useState, useCallback, useEffect } from "react";
import { draftComments } from "@/lib/api";
import { logger } from "@/lib/logger";
import type { PendingComment } from "@/lib/types/review";

export function useDraftComments(owner: string | undefined, repo: string | undefined, prNumber: number) {
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);

  const addComment = useCallback((file: string, lineStart: number, lineEnd: number, body: string, newLineNum?: number, newLineNumStart?: number) => {
    setPendingComments((prev) => {
      const newComment: PendingComment = { file, line: lineStart, lineEnd, body, newLineNum, newLineNumStart };
      // Fire-and-forget save to backend
      if (owner && repo && prNumber) {
        draftComments.save(owner, repo, prNumber, file, lineStart, lineEnd, body, newLineNum, newLineNumStart)
          .then((saved) => {
            setPendingComments((current) => {
              // Find the comment we just added (by reference match on body/file/line) and add the ID
              const idx = current.findIndex(
                (c) => !c.id && c.file === file && c.line === lineStart && c.lineEnd === lineEnd && c.body === body
              );
              if (idx >= 0) {
                const updated = [...current];
                updated[idx] = { ...updated[idx], id: saved.id };
                return updated;
              }
              return current;
            });
          })
          .catch((err) => logger.error("Failed to save draft comment:", err));
      }
      return [...prev, newComment];
    });
  }, [owner, repo, prNumber]);

  const editComment = useCallback((index: number, newBody: string) => {
    setPendingComments((prev) => {
      const comment = prev[index];
      if (comment?.id) {
        draftComments.update(comment.id, newBody).catch((err) =>
          logger.error("Failed to update draft comment:", err)
        );
      }
      return prev.map((c, i) => i === index ? { ...c, body: newBody } : c);
    });
  }, []);

  const deleteComment = useCallback((index: number) => {
    setPendingComments((prev) => {
      const comment = prev[index];
      if (comment?.id) {
        draftComments.delete(comment.id).catch((err) =>
          logger.error("Failed to delete draft comment:", err)
        );
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Load draft comments on mount
  const [hasLoadedDrafts, setHasLoadedDrafts] = useState(false);
  useEffect(() => {
    if (owner && repo && prNumber && !hasLoadedDrafts) {
      setHasLoadedDrafts(true);
      draftComments.get(owner, repo, prNumber)
        .then((drafts) => {
          if (drafts.length > 0) {
            setPendingComments(drafts.map((d) => ({
              id: d.id,
              file: d.file_path,
              line: d.line_start,
              lineEnd: d.line_end,
              body: d.body,
              newLineNum: d.new_line_num ?? undefined,
              newLineNumStart: d.new_line_num_start ?? undefined,
            })));
          }
        })
        .catch((err) => logger.error("Failed to load draft comments:", err));
    }
  }, [owner, repo, prNumber, hasLoadedDrafts]);

  return { pendingComments, setPendingComments, addComment, editComment, deleteComment };
}
