import type { AgentTurn, SandboxInstance, Workspace, Worktree } from "./domain";
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
  createWorkspace(input: CreateSandboxInput): Promise<SandboxInstance>;
  getWorkspace(workspaceId: string): Promise<SandboxInstance | null>;
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
  readonly instances = new Map<string, SandboxInstance>();

  async health(): Promise<SandboxHealth> {
    return { status: "ok", backend: "fake" };
  }

  async createWorkspace(input: CreateSandboxInput): Promise<SandboxInstance> {
    const now = new Date().toISOString();
    const instance: SandboxInstance = {
      id: `sandbox-${input.workspace.id}`,
      workspaceId: input.workspace.id,
      status: "ready",
      createdAt: now,
      lastActivityAt: now,
      expiresAt: input.workspace.expiresAt,
    };
    this.instances.set(instance.workspaceId, instance);
    return instance;
  }

  async getWorkspace(workspaceId: string): Promise<SandboxInstance | null> {
    return this.instances.get(workspaceId) ?? null;
  }

  async destroyWorkspace(workspaceId: string): Promise<void> {
    this.instances.delete(workspaceId);
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
