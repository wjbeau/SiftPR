import { MessageCircle, Pencil, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommentToolbar } from "@/components/CommentToolbar";
import type { PendingComment } from "@/lib/types/review";

interface PendingCommentWithIndex extends PendingComment {
  originalIndex: number;
}

interface PendingCommentDisplayProps {
  comment: PendingCommentWithIndex;
  isEditing: boolean;
  editingCommentText: string;
  setEditingCommentText: (text: string) => void;
  onStartEdit: (originalIndex: number, currentBody: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (originalIndex: number) => void;
  editTextareaRef: React.RefObject<HTMLTextAreaElement>;
}

export function PendingCommentDisplay({
  comment,
  isEditing,
  editingCommentText,
  setEditingCommentText,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  editTextareaRef,
}: PendingCommentDisplayProps) {
  return (
    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium font-sans">
            Pending comment
            {comment.lineEnd !== comment.line && (
              <span className="text-muted-foreground ml-1">
                (lines {comment.line + 1}-{comment.lineEnd + 1})
              </span>
            )}
          </span>
        </div>
        {!isEditing && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onStartEdit(comment.originalIndex, comment.body)}
              className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
              title="Edit comment"
            >
              <Pencil className="h-3.5 w-3.5 text-blue-500" />
            </button>
            <button
              onClick={() => onDelete(comment.originalIndex)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900"
              title="Delete comment"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <>
          <div className="border rounded overflow-hidden">
            <CommentToolbar
              textareaRef={editTextareaRef}
              value={editingCommentText}
              onChange={setEditingCommentText}
            />
            <textarea
              ref={editTextareaRef}
              value={editingCommentText}
              onChange={(e) => setEditingCommentText(e.target.value)}
              className="w-full p-2 text-sm bg-background resize-none font-sans border-0 focus:ring-0 focus:outline-none"
              rows={4}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={onCancelEdit}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onSaveEdit}
              disabled={!editingCommentText.trim()}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm font-sans whitespace-pre-wrap">{comment.body}</p>
      )}
    </div>
  );
}
