import { MessageCircle, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommentToolbar } from "@/components/CommentToolbar";
import type { DiffRow, LineSelection } from "@/lib/types/review";

interface CommentInputProps {
  commentingLines: LineSelection;
  commentText: string;
  setCommentText: (text: string) => void;
  selectedCodeForSuggestion?: string;
  onSubmit: () => void;
  onCancel: () => void;
  row: DiffRow;
  commentTextareaRef: React.RefObject<HTMLTextAreaElement>;
}

export function CommentInput({
  commentingLines,
  commentText,
  setCommentText,
  selectedCodeForSuggestion,
  onSubmit,
  onCancel,
  row,
  commentTextareaRef,
}: CommentInputProps) {
  return (
    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300 font-sans">
            {commentingLines.startIndex === commentingLines.endIndex
              ? `Comment on line ${row.right?.newLineNum || row.index + 1}`
              : `Comment on lines ${commentingLines.startIndex + 1}-${commentingLines.endIndex + 1}`}
          </span>
        </div>
        <button
          onClick={onCancel}
          className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
        >
          <X className="h-4 w-4 text-blue-500" />
        </button>
      </div>
      <div className="border rounded overflow-hidden">
        <CommentToolbar
          textareaRef={commentTextareaRef}
          value={commentText}
          onChange={setCommentText}
          selectedCode={selectedCodeForSuggestion}
        />
        <textarea
          ref={commentTextareaRef}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Write a comment... Use the toolbar above for formatting or type markdown directly."
          className="w-full p-2 text-sm bg-background resize-none font-sans border-0 focus:ring-0 focus:outline-none"
          rows={4}
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!commentText.trim()}
          className="gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          Add Comment
        </Button>
      </div>
    </div>
  );
}
