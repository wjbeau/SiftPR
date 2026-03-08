import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Cloud, Cpu, FolderGit, Bot } from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  description: string;
}

const navItems: NavItem[] = [
  {
    label: "AI Providers",
    href: "/settings/providers",
    icon: <Cloud className="h-4 w-4" />,
    description: "API keys & connections",
  },
  {
    label: "AI Models",
    href: "/settings/models",
    icon: <Cpu className="h-4 w-4" />,
    description: "Model selection",
  },
  {
    label: "Repositories",
    href: "/settings/repositories",
    icon: <FolderGit className="h-4 w-4" />,
    description: "Local repo links",
  },
  {
    label: "Agents",
    href: "/settings/agents",
    icon: <Bot className="h-4 w-4" />,
    description: "Agent customization",
  },
];

interface SettingsLayoutProps {
  children: ReactNode;
}

export function SettingsLayout({ children }: SettingsLayoutProps) {
  const location = useLocation();

  return (
    <div className="h-[calc(100vh-8rem)] flex -mx-8 -my-8">
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 border-r bg-muted/30">
        <div className="p-4 border-b">
          <h1 className="font-semibold">Settings</h1>
        </div>
        <nav className="p-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href ||
              (item.href === "/settings/providers" && location.pathname === "/settings");
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5 rounded-md transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="mt-0.5">{item.icon}</div>
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  );
}
