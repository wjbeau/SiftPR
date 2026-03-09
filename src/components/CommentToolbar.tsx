import { useCallback, RefObject } from "react";
import {
  Bold,
  Italic,
  Heading3,
  Quote,
  Code,
  Link,
  List,
  ListOrdered,
  ListChecks,
  GitCompareArrows,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CommentToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  selectedCode?: string; // The code being commented on, for suggested changes
  className?: string;
}

interface ToolbarButton {
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  action: "wrap" | "prefix" | "insert" | "suggestion";
  before?: string;
  after?: string;
  prefix?: string;
  insert?: string;
}

const toolbarButtons: ToolbarButton[] = [
  {
    icon: Bold,
    label: "Bold",
    shortcut: "Ctrl+B",
    action: "wrap",
    before: "**",
    after: "**",
  },
  {
    icon: Italic,
    label: "Italic",
    shortcut: "Ctrl+I",
    action: "wrap",
    before: "_",
    after: "_",
  },
  {
    icon: Heading3,
    label: "Heading",
    action: "prefix",
    prefix: "### ",
  },
  {
    icon: Quote,
    label: "Quote",
    action: "prefix",
    prefix: "> ",
  },
  {
    icon: Code,
    label: "Inline code",
    action: "wrap",
    before: "`",
    after: "`",
  },
  {
    icon: Link,
    label: "Link",
    action: "insert",
    insert: "[link text](url)",
  },
  {
    icon: List,
    label: "Bulleted list",
    action: "prefix",
    prefix: "- ",
  },
  {
    icon: ListOrdered,
    label: "Numbered list",
    action: "prefix",
    prefix: "1. ",
  },
  {
    icon: ListChecks,
    label: "Task list",
    action: "prefix",
    prefix: "- [ ] ",
  },
  {
    icon: GitCompareArrows,
    label: "Suggest changes",
    action: "suggestion",
  },
];

export function CommentToolbar({
  textareaRef,
  value,
  onChange,
  selectedCode,
  className,
}: CommentToolbarProps) {
  const insertText = useCallback(
    (button: ToolbarButton) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = value.substring(start, end);

      let newText = value;
      let newCursorPos = start;

      if (button.action === "wrap") {
        // Wrap selected text with before/after
        const before = button.before || "";
        const after = button.after || "";
        const wrapped = `${before}${selectedText || "text"}${after}`;
        newText = value.substring(0, start) + wrapped + value.substring(end);
        newCursorPos = start + before.length;
        if (!selectedText) {
          // Select the placeholder text
          setTimeout(() => {
            textarea.setSelectionRange(newCursorPos, newCursorPos + 4);
          }, 0);
        } else {
          newCursorPos = start + wrapped.length;
        }
      } else if (button.action === "prefix") {
        // Add prefix to line(s)
        const prefix = button.prefix || "";
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = value.indexOf("\n", end);
        const actualEnd = lineEnd === -1 ? value.length : lineEnd;

        // Get the selected lines
        const lines = value.substring(lineStart, actualEnd).split("\n");
        const prefixedLines = lines.map((line) => `${prefix}${line}`).join("\n");

        newText =
          value.substring(0, lineStart) + prefixedLines + value.substring(actualEnd);
        newCursorPos = lineStart + prefix.length + (start - lineStart);
      } else if (button.action === "insert") {
        // Insert text at cursor
        const insert = button.insert || "";
        newText = value.substring(0, start) + insert + value.substring(end);
        // Position cursor to edit the link text
        if (insert.includes("[link text]")) {
          newCursorPos = start + 1;
          setTimeout(() => {
            textarea.setSelectionRange(newCursorPos, newCursorPos + 9);
          }, 0);
        } else {
          newCursorPos = start + insert.length;
        }
      } else if (button.action === "suggestion") {
        // Insert suggestion block with the selected code
        const code = selectedCode || selectedText || "// your suggestion here";
        const suggestion = `\`\`\`suggestion\n${code}\n\`\`\``;

        // If there's already content, add a newline
        const needsNewlineBefore = start > 0 && value[start - 1] !== "\n";
        const prefix = needsNewlineBefore ? "\n" : "";

        newText =
          value.substring(0, start) + prefix + suggestion + value.substring(end);
        newCursorPos = start + prefix.length + 15; // Position after "```suggestion\n"
      }

      onChange(newText);

      // Focus and set cursor position
      setTimeout(() => {
        textarea.focus();
        if (button.action !== "wrap" || selectedText) {
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    },
    [textareaRef, value, onChange, selectedCode]
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "b") {
          e.preventDefault();
          const boldButton = toolbarButtons.find((b) => b.label === "Bold");
          if (boldButton) insertText(boldButton);
        } else if (e.key === "i") {
          e.preventDefault();
          const italicButton = toolbarButtons.find((b) => b.label === "Italic");
          if (italicButton) insertText(italicButton);
        }
      }
    },
    [insertText]
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex items-center gap-0.5 p-1 border-b bg-muted/30",
          className
        )}
        onKeyDown={handleKeyDown}
      >
        {toolbarButtons.map((button) => {
          const Icon = button.icon;
          const isSuggestion = button.action === "suggestion";

          // Add separator before suggestion button
          const showSeparator = isSuggestion;

          return (
            <div key={button.label} className="flex items-center">
              {showSeparator && (
                <div className="w-px h-4 bg-border mx-1" />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => insertText(button)}
                    className={cn(
                      "p-1.5 rounded hover:bg-muted transition-colors",
                      isSuggestion && "text-green-600 dark:text-green-400"
                    )}
                    tabIndex={-1}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <span>{button.label}</span>
                  {button.shortcut && (
                    <span className="ml-2 text-muted-foreground">
                      {button.shortcut}
                    </span>
                  )}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}

        <div className="flex-1" />

        <a
          href="https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-muted-foreground hover:text-foreground px-1"
          tabIndex={-1}
        >
          Markdown supported
        </a>
      </div>
    </TooltipProvider>
  );
}
