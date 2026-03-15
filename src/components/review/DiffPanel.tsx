import React from "react";
import { AlertTriangle, Sparkles, MessageSquare, ChevronDown, Plus } from "lucide-react";
import { GitHubFile, LineAnnotation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDiffPanel } from "@/lib/hooks/useDiffPanel";
import { DiffNavToolbar } from "./DiffNavToolbar";
import { ExpandableSection } from "./ExpandableSection";
import { CommentInput } from "./CommentInput";
import { PendingCommentDisplay } from "./PendingCommentDisplay";
import type { DiffLine, DiffRow, AIAnnotation, PendingComment } from "@/lib/types/review";

interface DiffPanelProps {
  file: GitHubFile | null;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
  onAddComment?: (file: string, lineStart: number, lineEnd: number, body: string, newLineNum?: number, newLineNumStart?: number) => void;
  onEditComment?: (index: number, newBody: string) => void;
  onDeleteComment?: (index: number) => void;
  pendingComments?: PendingComment[];
  aiAnnotations?: LineAnnotation[];
  onNavigateNextFile?: () => void;
  onNavigatePrevFile?: () => void;
}

export function DiffPanel({ file, owner, repo, baseSha, headSha: _headSha, onAddComment, onEditComment, onDeleteComment, pendingComments = [], aiAnnotations = [], onNavigateNextFile, onNavigatePrevFile }: DiffPanelProps) {
  // Note: _headSha is available for future use (e.g., verifying context lines match)
  const {
    commentingLines,
    setCommentingLines,
    commentText,
    setCommentText,
    selectionStart,
    setSelectionStart,
    currentHover,
    setCurrentHover,
    hoveredAnnotation,
    setHoveredAnnotation,
    expandedSections,
    editingCommentIndex,
    setEditingCommentIndex,
    editingCommentText,
    setEditingCommentText,
    currentNavigationIndex,
    containerRef,
    commentTextareaRef,
    editTextareaRef,
    diffRows,
    annotationsByLine,
    findingIndices,
    changeIndices,
    fileComments,
    selectedCodeForSuggestion,
    navigateToNextFinding,
    navigateToPrevFinding,
    navigateToNextChange,
    navigateToPrevChange,
    handleExpandSection,
  } = useDiffPanel(
    file,
    owner,
    repo,
    baseSha,
    pendingComments,
    aiAnnotations,
    onNavigateNextFile,
    onNavigatePrevFile,
  );

  // Early returns after all hooks
  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a file from the list to view its diff
      </div>
    );
  }

  if (!file.patch) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No diff available for this file (binary or too large)
      </div>
    );
  }

  const handleMouseDown = (index: number, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent text selection
    setSelectionStart(index);
    setCurrentHover(index);
  };

  const handleMouseEnter = (index: number) => {
    if (selectionStart !== null) {
      setCurrentHover(index);
    }
  };

  const handleMouseUp = () => {
    if (selectionStart !== null && currentHover !== null) {
      const start = Math.min(selectionStart, currentHover);
      const end = Math.max(selectionStart, currentHover);
      setCommentingLines({ startIndex: start, endIndex: end });
    }
    setSelectionStart(null);
    setCurrentHover(null);
  };

  const handleSubmitComment = () => {
    if (commentingLines && commentText.trim() && onAddComment) {
      // Look up actual line numbers for the GitHub API
      const startRow = diffRows[commentingLines.startIndex];
      const endRow = diffRows[commentingLines.endIndex];
      // Use new line number (right side) if available, fall back to old line number (left side)
      const newLineNum = endRow?.right?.newLineNum ?? endRow?.left?.oldLineNum;
      const newLineNumStart = startRow?.right?.newLineNum ?? startRow?.left?.oldLineNum;
      onAddComment(file.filename, commentingLines.startIndex, commentingLines.endIndex, commentText.trim(), newLineNum, newLineNumStart);
      setCommentText("");
      setCommentingLines(null);
    }
  };

  const handleStartEdit = (originalIndex: number, currentBody: string) => {
    setEditingCommentIndex(originalIndex);
    setEditingCommentText(currentBody);
  };

  const handleSaveEdit = () => {
    if (editingCommentIndex !== null && editingCommentText.trim() && onEditComment) {
      onEditComment(editingCommentIndex, editingCommentText.trim());
      setEditingCommentIndex(null);
      setEditingCommentText("");
    }
  };

  const handleCancelEdit = () => {
    setEditingCommentIndex(null);
    setEditingCommentText("");
  };

  const handleDelete = (originalIndex: number) => {
    if (onDeleteComment) {
      onDeleteComment(originalIndex);
    }
  };

  const isLineSelected = (index: number) => {
    if (!commentingLines) return false;
    return index >= commentingLines.startIndex && index <= commentingLines.endIndex;
  };

  const isLineInDrag = (index: number) => {
    if (selectionStart === null || currentHover === null) return false;
    const min = Math.min(selectionStart, currentHover);
    const max = Math.max(selectionStart, currentHover);
    return index >= min && index <= max;
  };

  const isDragging = selectionStart !== null;

  const renderGutter = (row: DiffRow, side: "left" | "right") => {
    const line = side === "left" ? row.left : row.right;
    const annotations = side === "right" ? annotationsByLine.get(row.index) : undefined;
    const hasAnnotation = annotations && annotations.length > 0;
    const isHovered = hoveredAnnotation === row.index;

    if (!line || line.type === "header" || line.type === "expandable") {
      return <div className="w-6 flex-shrink-0" />;
    }

    return (
      <div className="w-6 flex-shrink-0 flex items-center justify-center relative">
        {hasAnnotation && side === "right" && (
          <div
            className="relative"
            onMouseEnter={() => setHoveredAnnotation(row.index)}
            onMouseLeave={() => setHoveredAnnotation(null)}
          >
            {annotations[0].type === "warning" ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 cursor-pointer" />
            ) : annotations[0].type === "suggestion" ? (
              <Sparkles className="h-3.5 w-3.5 text-purple-500 cursor-pointer" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-blue-500 cursor-pointer" />
            )}

            {/* Tooltip */}
            {isHovered && (
              <div className="absolute left-6 top-0 z-50 w-72 p-2 bg-popover border rounded-md shadow-lg text-xs font-sans">
                {annotations.map((a: AIAnnotation, i: number) => (
                  <div key={i} className={cn("flex flex-col gap-1", i > 0 && "mt-2 pt-2 border-t")}>
                    <div className="flex items-start gap-2">
                      {a.type === "warning" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                      ) : a.type === "suggestion" ? (
                        <Sparkles className="h-3.5 w-3.5 text-purple-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                      )}
                      <span className="text-foreground">{a.message}</span>
                    </div>
                    {a.sources && a.sources.length > 0 && (
                      <div className="flex gap-1 pl-5 mt-1">
                        {a.sources.map((source) => (
                          <span key={source} className="text-[10px] px-1.5 py-0.5 bg-muted rounded capitalize">
                            {source}
                          </span>
                        ))}
                      </div>
                    )}
                    {a.suggestion && (
                      <div className="pl-5 mt-1 text-muted-foreground italic">
                        Suggestion: {a.suggestion}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLine = (line: DiffLine | null, side: "left" | "right", rowIndex: number) => {
    const isSelected = isLineSelected(rowIndex);
    const inDragRange = isLineInDrag(rowIndex);

    if (!line) {
      return (
        <div className="flex h-full flex-1">
          <span className="w-10 px-2 text-right text-muted-foreground/50 select-none text-xs bg-muted/30 flex items-center justify-end" />
          <pre className="flex-1 px-2 py-0.5 bg-muted/20"> </pre>
        </div>
      );
    }

    if (line.type === "expandable") {
      return (
        <button
          onClick={() => handleExpandSection(rowIndex, line.expandRange)}
          className="w-full flex items-center justify-center gap-2 py-1.5 bg-muted/50 hover:bg-muted text-muted-foreground text-xs transition-colors"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          <span>{line.content}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      );
    }

    if (line.type === "header") {
      return (
        <div className="flex bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex-1">
          <span className="w-10 px-2 text-right select-none text-xs flex items-center justify-end">
            ···
          </span>
          <pre className="flex-1 px-2 py-0.5 text-xs truncate">{line.content}</pre>
        </div>
      );
    }

    const lineNum = side === "left" ? line.oldLineNum : line.newLineNum;

    let bgClass = "";
    let textClass = "";
    if (line.type === "add") {
      bgClass = "bg-green-100 dark:bg-green-950/50";
      textClass = "text-green-800 dark:text-green-200";
    } else if (line.type === "remove") {
      bgClass = "bg-red-100 dark:bg-red-950/50";
      textClass = "text-red-800 dark:text-red-200";
    }

    // Selection highlighting - show blue background for drag selection
    if (inDragRange && side === "right") {
      bgClass = "bg-blue-200 dark:bg-blue-900/70";
    } else if (isSelected && side === "right") {
      bgClass = cn(bgClass, "ring-2 ring-inset ring-blue-400 dark:ring-blue-600");
    }

    return (
      <div
        className={cn(
          "flex group flex-1",
          bgClass,
          side === "right" && "cursor-pointer"
        )}
        style={{ userSelect: isDragging ? "none" : "auto" }}
        onMouseDown={(e) => side === "right" && line.type !== "header" && handleMouseDown(rowIndex, e)}
        onMouseEnter={() => side === "right" && handleMouseEnter(rowIndex)}
        onMouseUp={() => side === "right" && handleMouseUp()}
      >
        <span
          className={cn(
            "w-10 px-2 text-right select-none text-xs flex items-center justify-end",
            line.type === "context" ? "text-muted-foreground" : textClass
          )}
        >
          {lineNum}
        </span>
        <pre className={cn("flex-1 px-2 py-0.5 whitespace-pre-wrap break-all select-none", textClass)}>
          {line.content || " "}
        </pre>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="font-mono text-sm h-full flex flex-col" onMouseLeave={() => isDragging && handleMouseUp()}>
      {/* Sticky header with navigation toolbar */}
      <DiffNavToolbar
        navigateToPrevFinding={navigateToPrevFinding}
        navigateToNextFinding={navigateToNextFinding}
        navigateToPrevChange={navigateToPrevChange}
        navigateToNextChange={navigateToNextChange}
        onNavigatePrevFile={onNavigatePrevFile}
        onNavigateNextFile={onNavigateNextFile}
        findingIndices={findingIndices}
        changeIndices={changeIndices}
      />
      {/* Scrollable diff content */}
      <div className="flex-1 overflow-auto">
        {diffRows.map((row) => {
          // Get comments that start on this line
          const lineComments = fileComments.filter((c) => c.line === row.index);
          const isCommentingThisLine =
            commentingLines && row.index === commentingLines.endIndex;
          const isExpandable = row.left?.type === "expandable";

          if (isExpandable) {
            return (
              <div key={row.index}>
                <ExpandableSection
                  row={row}
                  expanded={expandedSections.get(row.index)}
                  onExpand={handleExpandSection}
                />
              </div>
            );
          }

          return (
            <div key={row.index} data-row-index={row.index}>
              <div className={cn(
                "flex border-b border-border/50 group/row",
                currentNavigationIndex === row.index && "ring-2 ring-inset ring-primary/50"
              )}>
                {/* Left gutter */}
                {renderGutter(row, "left")}

                {/* Left side (original) */}
                <div className="flex-1 border-r border-border/50 min-w-0 flex">
                  {renderLine(row.left, "left", row.index)}
                </div>

                {/* Right gutter */}
                {renderGutter(row, "right")}

                {/* Right side (modified) */}
                <div className="flex-1 min-w-0 relative flex">
                  {renderLine(row.right, "right", row.index)}
                  {/* Comment indicator for selected lines */}
                  {row.right && row.right.type !== "header" && row.right.type !== "expandable" && !isDragging && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setCommentingLines({ startIndex: row.index, endIndex: row.index });
                        }}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900"
                        title="Add comment"
                      >
                        <Plus className="h-3.5 w-3.5 text-blue-500" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Comment input - shown at end of selection */}
              {isCommentingThisLine && (
                <CommentInput
                  commentingLines={commentingLines}
                  commentText={commentText}
                  setCommentText={setCommentText}
                  selectedCodeForSuggestion={selectedCodeForSuggestion}
                  onSubmit={handleSubmitComment}
                  onCancel={() => {
                    setCommentingLines(null);
                    setCommentText("");
                  }}
                  row={row}
                  commentTextareaRef={commentTextareaRef}
                />
              )}

              {/* Show pending comments with edit/delete */}
              {lineComments.map((comment) => (
                <PendingCommentDisplay
                  key={comment.originalIndex}
                  comment={comment}
                  isEditing={editingCommentIndex === comment.originalIndex}
                  editingCommentText={editingCommentText}
                  setEditingCommentText={setEditingCommentText}
                  onStartEdit={handleStartEdit}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  onDelete={handleDelete}
                  editTextareaRef={editTextareaRef}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
