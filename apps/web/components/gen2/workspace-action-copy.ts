import {
  GEN2_AGENT_PROVIDERS,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

/** The words the activity rows, decision cards and announcements share. */
export type WorkspaceActionCopy = {
  /** Once it ran: "Opened src/app.ts:4 in Files". */
  done: string;
  /** As a request, lower-case: "invite ada as editor". */
  ask: string;
  /** The decision card's primary button. */
  primary: string;
};

function people(list: string[]) {
  if (list.length <= 3) {
    return list.length === 1
      ? list[0]!
      : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  }
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} others`;
}

function fileWithRange(action: {
  path: string;
  line?: number | undefined;
  endLine?: number | undefined;
}) {
  if (!action.line) return action.path;
  const end =
    action.endLine && action.endLine !== action.line
      ? `-${action.endLine}`
      : "";
  return `${action.path}:${action.line}${end}`;
}

function providerLabel(provider: string | undefined) {
  return GEN2_AGENT_PROVIDERS.find((entry) => entry.id === provider)?.label;
}

function copy(done: string, ask: string, primary: string) {
  return { done, ask, primary };
}

type Of<T extends Gen2WorkspaceAction["type"]> = Extract<
  Gen2WorkspaceAction,
  { type: T }
>;

function navigationCopy(
  action: Of<"open_file" | "show_changes" | "open_review" | "open_terminal">,
) {
  switch (action.type) {
    case "open_file": {
      const file = fileWithRange(action);
      return copy(`Opened ${file} in Files`, `open ${file} in Files`, "Open");
    }
    case "show_changes":
      return copy("Opened Changes", "show the changes", "Show changes");
    case "open_review":
      return action.path
        ? copy(
            `Opened the review of ${action.path}`,
            `review ${action.path}`,
            "Open review",
          )
        : copy("Opened Review", "open the review", "Open review");
    case "open_terminal":
      return copy("Opened the terminal", "open the terminal", "Open terminal");
  }
}

function branchCopy(
  action: Of<"switch_worktree" | "open_branch" | "create_branch">,
) {
  switch (action.type) {
    case "switch_worktree":
      return copy(
        `Switched to ${action.worktreeId}`,
        `switch to ${action.worktreeId}`,
        "Switch",
      );
    case "open_branch":
      return copy(
        `Opened ${action.branch}`,
        `open ${action.branch}`,
        "Open branch",
      );
    case "create_branch":
      return copy(
        `Created ${action.branch}`,
        `create the branch ${action.branch}`,
        "Create branch",
      );
  }
}

function peopleCopy(
  action: Of<"open_share" | "invite_members" | "start_chat">,
) {
  switch (action.type) {
    case "open_share":
      return copy(
        "Opened Share",
        action.emailOrLogin
          ? `open Share to invite ${action.emailOrLogin}`
          : "open Share",
        "Open Share",
      );
    case "invite_members": {
      const who = people(action.people);
      const role = action.people.length === 1 ? action.role : `${action.role}s`;
      return copy(`Invited ${who}`, `invite ${who} as ${role}`, "Send invites");
    }
    case "start_chat": {
      const agent = providerLabel(action.provider);
      const chat = agent ? `${agent} chat` : "chat";
      return copy(
        `Started a new ${chat}`,
        `continue in a new ${chat}`,
        "Start chat",
      );
    }
  }
}

export function workspaceActionCopy(
  action: Gen2WorkspaceAction,
): WorkspaceActionCopy {
  switch (action.type) {
    case "open_preview": {
      const where = `:${action.port}${action.path && action.path !== "/" ? action.path : ""}`;
      return copy(
        `Opened ${where} in Browser`,
        `preview ${where}`,
        "Open preview",
      );
    }
    case "rename_chat":
      return copy(
        `Renamed this chat to “${action.title}”`,
        `rename this chat to “${action.title}”`,
        "Rename chat",
      );
    case "run_in_terminal":
      return copy(
        `Ran ${action.command} in a new terminal`,
        `run ${action.command} in a new terminal`,
        "Run in terminal",
      );
    case "open_settings":
      return copy("Opened Settings", "open Settings", "Open settings");
    case "update_goal":
      return copy(
        "Marked the goal achieved",
        "mark the goal achieved",
        "Mark achieved",
      );
    case "switch_worktree":
    case "open_branch":
    case "create_branch":
      return branchCopy(action);
    case "open_share":
    case "invite_members":
    case "start_chat":
      return peopleCopy(action);
    default:
      return navigationCopy(action);
  }
}
