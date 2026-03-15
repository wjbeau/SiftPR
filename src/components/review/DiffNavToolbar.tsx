import { ChevronUp, ChevronDown, ArrowLeft, Sparkles, Files } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiffNavToolbarProps {
  navigateToPrevFinding: () => void;
  navigateToNextFinding: () => void;
  navigateToPrevChange: () => void;
  navigateToNextChange: () => void;
  onNavigatePrevFile?: () => void;
  onNavigateNextFile?: () => void;
  findingIndices: number[];
  changeIndices: number[];
}

export function DiffNavToolbar({
  navigateToPrevFinding,
  navigateToNextFinding,
  navigateToPrevChange,
  navigateToNextChange,
  onNavigatePrevFile,
  onNavigateNextFile,
  findingIndices,
  changeIndices,
}: DiffNavToolbarProps) {
  return (
    <div className="flex border-b bg-muted/50 text-xs text-muted-foreground sticky top-0 z-10 flex-shrink-0">
      <div className="w-6" /> {/* Gutter spacer */}
      <div className="flex-1 px-4 py-1.5 border-r">Original</div>
      <div className="w-6" /> {/* Gutter spacer */}
      <div className="flex-1 px-4 py-1.5 flex items-center justify-between">
        <span>Modified</span>
        {/* Navigation toolbar */}
        <div className="flex items-center gap-2 font-sans">
          {/* AI Findings navigation */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={navigateToPrevFinding}
              disabled={findingIndices.length === 0}
              title="Previous AI finding ([)"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={navigateToNextFinding}
              disabled={findingIndices.length === 0}
              title="Next AI finding (])"
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded ml-0.5" title="AI findings">
              <Sparkles className="h-2.5 w-2.5 inline mr-0.5" />
              {findingIndices.length}
            </span>
          </div>

          <div className="w-px h-3 bg-border" />

          {/* Changes navigation */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={navigateToPrevChange}
              disabled={changeIndices.length === 0}
              title="Previous change (k)"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={navigateToNextChange}
              disabled={changeIndices.length === 0}
              title="Next change (j)"
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded ml-0.5" title="Changed lines">
              {changeIndices.length}
            </span>
          </div>

          <div className="w-px h-3 bg-border" />

          {/* File navigation */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onNavigatePrevFile}
              disabled={!onNavigatePrevFile}
              title="Previous file (p)"
            >
              <ArrowLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onNavigateNextFile}
              disabled={!onNavigateNextFile}
              title="Next file (n)"
            >
              <ArrowLeft className="h-3 w-3 rotate-180" />
            </Button>
            <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded ml-0.5" title="Files">
              <Files className="h-2.5 w-2.5 inline" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
