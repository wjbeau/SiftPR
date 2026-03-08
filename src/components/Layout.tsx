import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export function Layout() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="text-xl font-bold">
              SiftPR
            </Link>
            <nav className="flex items-center gap-4">
              <Link
                to="/"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Home
              </Link>
              {user && (
                <Link
                  to="/settings"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Settings
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <div className="flex items-center gap-2">
                  {user.github_avatar_url && (
                    <img
                      src={user.github_avatar_url}
                      alt={user.github_username}
                      className="h-8 w-8 rounded-full"
                    />
                  )}
                  <span className="text-sm">{user.github_username}</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                  Logout
                </Button>
              </>
            ) : (
              <Button asChild>
                <Link to="/login">Login with GitHub</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="container py-8">
        <Outlet />
      </main>
    </div>
  );
}
