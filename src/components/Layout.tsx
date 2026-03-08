import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabBar } from "@/components/TabBar";
import { useTabs } from "@/contexts/TabsContext";
import { Settings, LogOut, ChevronDown, Sun, Moon, Monitor } from "lucide-react";

export function Layout() {
  const { user, isLoading, logout } = useAuth();
  const { setActiveTab } = useTabs();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
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

  if (isLoading) {
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
                    onClick={cycleTheme}
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
                    onClick={handleLogout}
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
      <main className="container py-6 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
