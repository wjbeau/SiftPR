import {
  FileCode,
  Layers,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Braces,
  Settings2,
} from "lucide-react";
import type { CodebaseProfile } from "@/lib/api";

interface RepoProfilePanelProps {
  profileData: CodebaseProfile;
  aiSummary: string | null;
  isAnalyzing: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export function RepoProfilePanel({ profileData, aiSummary, isAnalyzing, isExpanded, onToggle }: RepoProfilePanelProps) {
  return (
    <div className="pl-6 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileCode className="h-3 w-3" />
          {profileData.file_count} files
        </span>
        {profileData.language_breakdown && Object.keys(profileData.language_breakdown).length > 0 && (() => {
          const langs = Object.keys(profileData.language_breakdown);
          return (
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {langs.slice(0, 4).join(", ")}
              {langs.length > 4 && ` +${langs.length - 4}`}
            </span>
          );
        })()}
        {profileData.documentation_files && profileData.documentation_files.length > 0 && (
          <span className="text-green-600 dark:text-green-400">
            {profileData.documentation_files.length} doc{profileData.documentation_files.length !== 1 ? "s" : ""} found
          </span>
        )}
        <button
          onClick={onToggle}
          className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          View details
        </button>
      </div>

      {/* Expanded profile details */}
      {isExpanded && (
        <div className="mt-2 p-3 bg-muted/50 rounded-md space-y-3 text-xs">
          {/* AI Summary */}
          {aiSummary ? (
            <div>
              <div className="font-medium text-foreground flex items-center gap-1 mb-1.5">
                <Layers className="h-3 w-3 text-violet-500" />
                AI Profiler Summary
              </div>
              <div className="prose prose-xs dark:prose-invert max-w-none text-xs text-muted-foreground [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground whitespace-pre-wrap">
                {aiSummary}
              </div>
            </div>
          ) : !isAnalyzing && (
            <div className="text-muted-foreground italic">
              No AI summary yet. Click "Re-analyze" to generate one (requires an AI provider).
            </div>
          )}

          <div className="border-t pt-2" />

          {/* Languages */}
          {profileData.language_breakdown && Object.keys(profileData.language_breakdown).length > 0 && (
            <div>
              <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                <Layers className="h-3 w-3" />
                Languages
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(profileData.language_breakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([lang, count]) => (
                    <span key={lang} className="px-1.5 py-0.5 bg-background border rounded text-muted-foreground">
                      {lang} <span className="text-foreground font-medium">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Patterns */}
          {profileData.patterns && (
            <div>
              <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                <Braces className="h-3 w-3" />
                Detected Patterns
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                {profileData.patterns.file_organization && (
                  <div>Structure: <span className="text-foreground">{profileData.patterns.file_organization}</span></div>
                )}
                {profileData.patterns.import_style && (
                  <div>Imports: <span className="text-foreground">{profileData.patterns.import_style}</span></div>
                )}
                {profileData.patterns.error_handling_pattern && (
                  <div>Errors: <span className="text-foreground">{profileData.patterns.error_handling_pattern}</span></div>
                )}
                {typeof profileData.patterns.naming_conventions === "string"
                  ? profileData.patterns.naming_conventions && (
                      <div>Naming: <span className="text-foreground">{profileData.patterns.naming_conventions}</span></div>
                    )
                  : profileData.patterns.naming_conventions?.functions && (
                      <div>Naming: <span className="text-foreground">{profileData.patterns.naming_conventions.functions}</span></div>
                    )}
              </div>
              {profileData.patterns.common_abstractions && profileData.patterns.common_abstractions.length > 0 && (
                <div className="mt-1 text-muted-foreground">
                  Abstractions: <span className="text-foreground">{profileData.patterns.common_abstractions.join(", ")}</span>
                </div>
              )}
            </div>
          )}

          {/* Style */}
          {profileData.style_summary && (
            <div>
              <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                <Settings2 className="h-3 w-3" />
                Code Style
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                {profileData.style_summary.indentation && (
                  <div>Indent: <span className="text-foreground">{profileData.style_summary.indentation}</span></div>
                )}
                {profileData.style_summary.quote_style && (
                  <div>Quotes: <span className="text-foreground">{profileData.style_summary.quote_style}</span></div>
                )}
                {profileData.style_summary.documentation_style && (
                  <div>Docs: <span className="text-foreground">{profileData.style_summary.documentation_style}</span></div>
                )}
                {profileData.style_summary.typical_file_length > 0 && (
                  <div>Avg file: <span className="text-foreground">{profileData.style_summary.typical_file_length} lines</span></div>
                )}
              </div>
            </div>
          )}

          {/* Documentation files */}
          {profileData.documentation_files && profileData.documentation_files.length > 0 && (
            <div>
              <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                <BookOpen className="h-3 w-3" />
                Documentation Ingested
              </div>
              <div className="flex flex-wrap gap-1.5">
                {profileData.documentation_files.map((doc) => (
                  <span key={doc.path} className="px-1.5 py-0.5 bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800 rounded">
                    {doc.path}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-muted-foreground">
                Content from these files is included in AI review context.
              </p>
            </div>
          )}

          {/* Config files */}
          {profileData.config_files && profileData.config_files.length > 0 && (
            <div>
              <div className="font-medium text-foreground flex items-center gap-1 mb-1">
                <Settings2 className="h-3 w-3" />
                Config Files Detected
              </div>
              <div className="flex flex-wrap gap-1.5">
                {profileData.config_files.map((cfg) => (
                  <span key={cfg.path} className="px-1.5 py-0.5 bg-background border rounded text-muted-foreground">
                    {cfg.path}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
