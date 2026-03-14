import { useEffect, useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabBar } from "@/components/TabBar";
import { useTabs } from "@/contexts/TabsContext";
import { Settings, LogOut, ChevronDown, Sun, Moon, Monitor, X } from "lucide-react";

export function Layout() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const { setActiveTab } = useTabs();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const isReviewPage = location.pathname.match(/^\/review\//);

  const [keepDataOnLogout, setKeepDataOnLogout] = useState(true);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isLoading, isAuthenticated, navigate]);

  const handleLogout = (keepData: boolean) => {
    logout(keepData).then(() => {
      setShowLogoutDialog(false);
      navigate("/login");
    }).catch((err) => {
      logger.error("Logout failed:", err);
    });
  };

  const handleLogoClick = () => {
    setActiveTab("home");
  };

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const getThemeIcon = () => {
    if (theme === "light") return <Sun className="h-4 w-4" />;
    if (theme === "dark") return <Moon className="h-4 w-4" />;
    return <Monitor className="h-4 w-4" />;
  };

  const getThemeLabel = () => {
    if (theme === "light") return "Light";
    if (theme === "dark") return "Dark";
    return "System";
  };

  // Show loading while checking auth, or nothing while redirecting to login
  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b flex-shrink-0">
        <div className="container flex h-14 items-center justify-between">
          <button
            type="button"
            onClick={handleLogoClick}
            className="flex items-center hover:opacity-80 transition-opacity"
          >
            <img src="/logo.png" alt="SiftPR" className="h-8" />
          </button>
          <div className="flex items-center gap-4">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {user.github_avatar_url && (
                      <img
                        src={user.github_avatar_url}
                        alt={user.github_username}
                        className="h-8 w-8 rounded-full"
                      />
                    )}
                    <span className="text-sm">{user.github_username}</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={cycleTheme}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      {getThemeIcon()}
                      Theme
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {getThemeLabel()}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      // Use setTimeout to let the dropdown fully close before showing dialog,
                      // otherwise the dropdown's invisible overlay captures pointer events
                      setTimeout(() => setShowLogoutDialog(true), 0);
                    }}
                    className="flex items-center gap-2 text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild>
                <Link to="/login">Login with GitHub</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <TabBar />
      <main className={isReviewPage ? "flex-1 overflow-auto" : "container py-6 flex-1 overflow-auto"}>
        <Outlet />
      </main>

      {/* Logout confirmation dialog */}
      {showLogoutDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowLogoutDialog(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[380px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold">Log out</h3>
              <button onClick={() => setShowLogoutDialog(false)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-4">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepDataOnLogout}
                  onChange={(e) => setKeepDataOnLogout(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                <div>
                  <span className="text-sm font-medium">Keep my settings</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    AI providers, agent configs, and linked repos will be restored on next login
                  </p>
                </div>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLogoutDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleLogout(keepDataOnLogout)}
              >
                Log out
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
