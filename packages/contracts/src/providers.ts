import type { AgentTurn, Workspace, Worktree } from "./domain";
import type { WorkspaceEvent } from "./events";

export interface CreateSandboxInput {
  workspace: Workspace;
  repositoryUrl: string;
}

export interface SandboxHealth {
  status: "ok" | "degraded";
  backend: string;
}

export interface SandboxBackend {
  health(): Promise<SandboxHealth>;
  createWorkspace(input: CreateSandboxInput): Promise<void>;
  destroyWorkspace(workspaceId: string): Promise<void>;
  createWorktree(worktree: Worktree): Promise<void>;
  readFile(worktreeId: string, path: string): Promise<string>;
  writeFile(
    worktreeId: string,
    path: string,
    contents: string,
    expectedRevision: string,
  ): Promise<{ revision: string }>;
}

export interface AgentRunContext {
  workspace: Workspace;
  worktree: Worktree;
  turn: AgentTurn;
}

export interface AgentProvider {
  readonly name: string;
  run(context: AgentRunContext): AsyncIterable<WorkspaceEvent>;
  interrupt(turnId: string): Promise<void>;
}

export class FakeSandboxBackend implements SandboxBackend {
  readonly files = new Map<string, string>();

  async health(): Promise<SandboxHealth> {
    return { status: "ok", backend: "fake" };
  }

  async createWorkspace(_input: CreateSandboxInput): Promise<void> {}

  async destroyWorkspace(workspaceId: string): Promise<void> {
    for (const key of this.files.keys()) {
      if (key.startsWith(`${workspaceId}:`)) {
        this.files.delete(key);
      }
    }
  }

  async createWorktree(_worktree: Worktree): Promise<void> {}

  async readFile(worktreeId: string, path: string): Promise<string> {
    return this.files.get(`${worktreeId}:${path}`) ?? "";
  }

  async writeFile(
    worktreeId: string,
    path: string,
    contents: string,
    expectedRevision: string,
  ): Promise<{ revision: string }> {
    const revision = `${expectedRevision}:next`;
    this.files.set(`${worktreeId}:${path}`, contents);
    return { revision };
  }
}

export class FakeAgentProvider implements AgentProvider {
  readonly name = "fake";
  readonly events: WorkspaceEvent[] = [];

  async *run(_context: AgentRunContext): AsyncIterable<WorkspaceEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  async interrupt(_turnId: string): Promise<void> {}
}
