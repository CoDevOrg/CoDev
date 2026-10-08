import { Bot, FolderGit2, Users, Rocket } from "lucide-react";

export const guides = [
  {
    id: "getting-started",
    title: "Get started",
    icon: Rocket,
    summary: "From your first invite to a workspace ready to build in.",
    steps: [
      "Join the private beta waitlist. We’ll email you when access is available.",
      "Once you have access, sign in and connect your GitHub account.",
      "Choose a repository and open a cloud workspace. Your editor, terminal, and Git work from the same checkout.",
    ],
  },
  {
    id: "team",
    title: "Invite your team",
    icon: Users,
    summary: "Share a link. Build in the same editor and terminal.",
    steps: [
      "Share your workspace link with a teammate. They can sign in and join the workspace.",
      "Follow each other’s edits and agent sessions as work happens.",
      "Run your app and review it together on the workspace’s shared preview. You don’t need to commit and push just to show a change.",
    ],
  },
  {
    id: "agents",
    title: "Connect your agents",
    icon: Bot,
    summary: "Bring your own OpenAI, Claude, or Cursor subscription.",
    steps: [
      "Open Settings and connect the AI account you want to use. Follow the provider’s sign-in instructions.",
      "Start an agent session in your workspace and give it a specific task.",
      "Divide tasks across separate files. Follow agent progress and review changes before keeping them.",
    ],
  },
  {
    id: "worktrees",
    title: "Work in parallel",
    icon: FolderGit2,
    summary: "Give each task its own checkout with Git worktrees.",
    steps: [
      "Use a separate worktree when a teammate or agent needs to work independently.",
      "Each worktree has its own files and branch, so changes stay separate while you build.",
      "Run tests in the checkout you’re working on, review the diff, and bring the finished changes back into your team’s branch.",
    ],
  },
] as const;
