import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Bot, Wrench, Shield, FileSearch, AlertTriangle, Lightbulb } from "lucide-react";

const agents = [
  {
    name: "Security Agent",
    description: "Scans for security vulnerabilities and potential risks",
    icon: Shield,
    color: "text-red-500",
    bgColor: "bg-red-100 dark:bg-red-950",
  },
  {
    name: "Architecture Agent",
    description: "Reviews code structure and architectural patterns",
    icon: Wrench,
    color: "text-blue-500",
    bgColor: "bg-blue-100 dark:bg-blue-950",
  },
  {
    name: "Logic Agent",
    description: "Analyzes business logic and potential bugs",
    icon: AlertTriangle,
    color: "text-amber-500",
    bgColor: "bg-amber-100 dark:bg-amber-950",
  },
  {
    name: "Documentation Agent",
    description: "Checks documentation and code comments",
    icon: FileSearch,
    color: "text-green-500",
    bgColor: "bg-green-100 dark:bg-green-950",
  },
  {
    name: "Suggestions Agent",
    description: "Provides improvement suggestions and best practices",
    icon: Lightbulb,
    color: "text-purple-500",
    bgColor: "bg-purple-100 dark:bg-purple-950",
  },
];

export function Agents() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">AI Agents</h2>
        <p className="text-muted-foreground">
          Customize the AI agents used in PR analysis orchestration.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Agent Configuration
          </CardTitle>
          <CardDescription>
            Each agent specializes in a different aspect of code review.
            Agent customization coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {agents.map((agent) => (
              <div
                key={agent.name}
                className="flex items-center gap-4 p-4 border rounded-lg opacity-75"
              >
                <div className={`p-2 rounded-lg ${agent.bgColor}`}>
                  <agent.icon className={`h-5 w-5 ${agent.color}`} />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {agent.description}
                  </div>
                </div>
                <span className="text-xs bg-muted px-2 py-1 rounded">
                  Coming Soon
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">Agent Customization Coming Soon</p>
            <p className="text-sm mt-2">
              You'll be able to customize prompts, enable/disable agents,
              and configure agent-specific settings.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
