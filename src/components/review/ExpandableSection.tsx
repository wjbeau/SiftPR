import { Loader2, ChevronDown } from "lucide-react";
import type { DiffRow, DiffLine, ExpandedSection } from "@/lib/types/review";

interface ExpandableSectionProps {
  row: DiffRow;
  expanded: ExpandedSection | undefined;
  onExpand: (rowIndex: number, expandRange?: DiffLine["expandRange"]) => void;
}

export function ExpandableSection({ row, expanded, onExpand }: ExpandableSectionProps) {
  if (expanded?.loading) {
    return (
      <div data-row-index={row.index} className="border-b border-border/50 bg-muted/30 p-2 text-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        Loading expanded content...
      </div>
    );
  }

  if (expanded?.error) {
    return (
      <div data-row-index={row.index} className="border-b border-border/50 bg-red-50 dark:bg-red-950/30 p-2 text-center text-xs text-red-600 dark:text-red-400">
        Failed to load: {expanded.error}
        <button
          onClick={() => onExpand(row.index, row.left?.expandRange)}
          className="ml-2 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (expanded?.lines && expanded.lines.length > 0) {
    // Render the expanded context lines
    const expandRange = row.left?.expandRange;
    return (
      <div data-row-index={row.index}>
        {expanded.lines.map((lineContent, i) => {
          const lineNum = (expandRange?.oldStart ?? 1) + i;
          return (
            <div key={`expanded-${row.index}-${i}`} className="flex border-b border-border/50 bg-yellow-50/50 dark:bg-yellow-950/20">
              <div className="w-6 flex-shrink-0" />
              <div className="flex-1 border-r border-border/50 min-w-0 flex">
                <span className="w-10 px-2 text-right text-muted-foreground select-none text-xs flex items-center justify-end bg-yellow-100/50 dark:bg-yellow-900/30">
                  {lineNum}
                </span>
                <pre className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">{lineContent || " "}</pre>
              </div>
              <div className="w-6 flex-shrink-0" />
              <div className="flex-1 min-w-0 flex">
                <span className="w-10 px-2 text-right text-muted-foreground select-none text-xs flex items-center justify-end bg-yellow-100/50 dark:bg-yellow-900/30">
                  {lineNum}
                </span>
                <pre className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">{lineContent || " "}</pre>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Not yet expanded - show expand button
  return (
    <div data-row-index={row.index} className="border-b border-border/50">
      <button
        onClick={() => onExpand(row.index, row.left?.expandRange)}
        className="w-full flex items-center justify-center gap-2 py-2 bg-muted/30 hover:bg-muted/50 text-muted-foreground text-xs transition-colors cursor-pointer"
      >
        <ChevronDown className="h-3.5 w-3.5" />
        <span>{row.left?.content || "Expand hidden lines"}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
