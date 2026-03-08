import { useRef, useEffect } from "react";
import { useTabs, type Tab } from "@/contexts/TabsContext";
import { cn } from "@/lib/utils";
import { X, Home, GitPullRequest } from "lucide-react";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabs();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Separate home tab from other tabs
  const homeTab = tabs.find((t) => t.type === "home");
  const otherTabs = tabs.filter((t) => t.type !== "home");

  // Scroll active tab into view when it changes
  useEffect(() => {
    if (activeTabRef.current && scrollContainerRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeTabId]);

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  return (
    <div className="flex items-center border-b bg-muted/30">
      {/* Home tab - fixed, doesn't scroll */}
      {homeTab && (
        <TabItem
          tab={homeTab}
          isActive={homeTab.id === activeTabId}
          onClick={() => setActiveTab(homeTab.id)}
          onClose={() => {}}
          ref={null}
        />
      )}

      {/* Other tabs - scrollable */}
      <div
        ref={scrollContainerRef}
        className="flex-1 flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent"
        style={{ scrollbarWidth: "thin" }}
      >
        {otherTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onClick={() => setActiveTab(tab.id)}
            onClose={(e) => handleClose(e, tab.id)}
            ref={tab.id === activeTabId ? activeTabRef : null}
          />
        ))}
      </div>
    </div>
  );
}

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

const TabItem = ({
  tab,
  isActive,
  onClick,
  onClose,
  ref,
}: TabItemProps & { ref: React.Ref<HTMLButtonElement> }) => {
  const isHome = tab.type === "home";
  const isPR = tab.type === "pr";

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap border-r border-border transition-colors flex-shrink-0",
        "hover:bg-accent/50",
        isActive
          ? "bg-background text-foreground border-b-2 border-b-primary -mb-px"
          : "text-muted-foreground"
      )}
    >
      {isHome && <Home className="h-4 w-4 flex-shrink-0" />}
      {isPR && <GitPullRequest className="h-4 w-4 flex-shrink-0" />}

      <span className="max-w-[200px] truncate">{tab.title}</span>

      {!isHome && (
        <span
          role="button"
          tabIndex={0}
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              onClose(e as unknown as React.MouseEvent);
            }
          }}
          className={cn(
            "ml-1 p-0.5 rounded-sm hover:bg-muted-foreground/20 transition-colors flex-shrink-0",
            "opacity-0 group-hover:opacity-100",
            isActive && "opacity-100"
          )}
        >
          <X className="h-3 w-3" />
        </span>
      )}
    </button>
  );
};
