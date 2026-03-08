import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export interface Tab {
  id: string;
  title: string;
  type: "home" | "pr" | "settings";
  path: string;
  // PR-specific metadata
  prInfo?: {
    owner: string;
    repo: string;
    number: number;
  };
}

interface TabsContextValue {
  tabs: Tab[];
  activeTabId: string;
  openTab: (tab: Omit<Tab, "id">) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const HOME_TAB: Tab = {
  id: "home",
  title: "Home",
  type: "home",
  path: "/",
};

const STORAGE_KEY = "siftpr-tabs";

interface StoredTabsState {
  tabs: Tab[];
  activeTabId: string;
}

function loadTabsFromStorage(): StoredTabsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredTabsState;
      // Ensure home tab is always first
      const hasHome = parsed.tabs.some((t) => t.id === "home");
      if (!hasHome) {
        parsed.tabs.unshift(HOME_TAB);
      }
      return parsed;
    }
  } catch {
    // Ignore errors
  }
  return { tabs: [HOME_TAB], activeTabId: "home" };
}

function saveTabsToStorage(tabs: Tab[], activeTabId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
  } catch {
    // Ignore errors
  }
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [tabs, setTabs] = useState<Tab[]>(() => loadTabsFromStorage().tabs);
  const [activeTabId, setActiveTabIdState] = useState<string>(
    () => loadTabsFromStorage().activeTabId
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // Save to storage whenever tabs change (but not during initialization)
  useEffect(() => {
    if (isInitialized) {
      saveTabsToStorage(tabs, activeTabId);
    }
  }, [tabs, activeTabId, isInitialized]);

  // Restore active tab on mount - navigate to the stored active tab
  useEffect(() => {
    const stored = loadTabsFromStorage();
    const activeTab = stored.tabs.find((t) => t.id === stored.activeTabId);

    if (activeTab && activeTab.path !== location.pathname) {
      // Navigate to the stored active tab
      navigate(activeTab.path, { replace: true });
    }

    setIsInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTab = useCallback(
    (tabData: Omit<Tab, "id">) => {
      // Generate ID based on type and path
      const id = tabData.type === "pr" && tabData.prInfo
        ? `pr-${tabData.prInfo.owner}-${tabData.prInfo.repo}-${tabData.prInfo.number}`
        : tabData.path;

      setTabs((currentTabs) => {
        // Check if tab already exists
        const existingTab = currentTabs.find((t) => t.id === id);
        if (existingTab) {
          return currentTabs;
        }
        // Add new tab
        return [...currentTabs, { ...tabData, id }];
      });

      setActiveTabIdState(id);
      navigate(tabData.path);
    },
    [navigate]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      // Cannot close home tab
      if (tabId === "home") return;

      setTabs((currentTabs) => {
        const tabIndex = currentTabs.findIndex((t) => t.id === tabId);
        if (tabIndex === -1) return currentTabs;

        const newTabs = currentTabs.filter((t) => t.id !== tabId);

        // If closing the active tab, switch to adjacent tab
        if (activeTabId === tabId) {
          // Prefer the tab to the left, or home if none
          const newActiveIndex = Math.max(0, tabIndex - 1);
          const newActiveTab = newTabs[newActiveIndex];
          setActiveTabIdState(newActiveTab.id);
          navigate(newActiveTab.path);
        }

        return newTabs;
      });
    },
    [activeTabId, navigate]
  );

  const setActiveTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        setActiveTabIdState(tabId);
        navigate(tab.path);
      }
    },
    [tabs, navigate]
  );

  return (
    <TabsContext.Provider
      value={{
        tabs,
        activeTabId,
        openTab,
        closeTab,
        setActiveTab,
      }}
    >
      {children}
    </TabsContext.Provider>
  );
}

export function useTabs() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("useTabs must be used within a TabsProvider");
  }
  return context;
}
