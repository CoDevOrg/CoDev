/**
 * An in-memory stand-in for the Firecracker guest.
 *
 * The orchestrator and its guest live on Azure, so nothing that talks to them
 * could be exercised locally or in tests -- the whole Gen 2 surface was
 * verifiable only by static checks. This implements the same HTTP contract
 * over a map of files, which makes the real code paths (routes, domain
 * modules, the poll loops) runnable end to end.
 *
 * It is a *contract* double, not a simulator: it models what the guest
 * promises (revisions, sequences, porcelain output, NDJSON turn events), not
 * how it achieves it. Enabled by `CODEV_FAKE_GUEST=1`; never reachable in
 * production, where the env var is unset.
 */

type FakeFile = { contents: string; committed: string | null };

type FakeTerminal = {
  chunks: { sequence: number; data: string }[];
  next: number;
  exited: boolean;
  exitCode: number | null;
  cwd: string;
};

type FakeCodexExec = {
  chunks: { sequence: number; dataBase64: string }[];
  next: number;
  exited: boolean;
  exitCode: number | null;
};

type FakeSandbox = {
  id: string;
  files: Map<string, FakeFile>;
  terminals: Map<string, FakeTerminal>;
  execs: Map<string, FakeCodexExec>;
  counter: number;
};

const sandboxes = new Map<string, FakeSandbox>();

export function fakeGuestEnabled() {
  return process.env.CODEV_FAKE_GUEST === "1";
}

/** Exposed so tests can start from a known machine. */
export function resetFakeGuest() {
  sandboxes.clear();
}

export function fakeGuestSandbox(workspaceId: string) {
  return sandboxes.get(workspaceId);
}

function revisionOf(contents: string) {
  // The real guest uses a content hash; any stable function of the contents
  // satisfies the compare-and-set contract callers depend on.
  let hash = 0;
  for (let index = 0; index < contents.length; index += 1) {
    hash = (hash * 31 + contents.charCodeAt(index)) | 0;
  }
  return `r${(hash >>> 0).toString(16)}`;
}

function seed(workspaceId: string): FakeSandbox {
  const files = new Map<string, FakeFile>();
  const readme = "This is a CoDev workspace.\n";
  files.set("README.md", { contents: readme, committed: readme });
  const sandbox: FakeSandbox = {
    id: `fake-${workspaceId.slice(0, 8)}`,
    files,
    terminals: new Map(),
    execs: new Map(),
    counter: 0,
  };
  sandboxes.set(workspaceId, sandbox);
  return sandbox;
}

function require(workspaceId: string) {
  const sandbox = sandboxes.get(workspaceId);
  if (!sandbox) throw new FakeGuestMissing();
  return sandbox;
}

class FakeGuestMissing extends Error {}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function statusFor(file: FakeFile) {
  if (file.committed === null) return "??";
  return file.contents === file.committed ? null : " M";
}

function porcelain(sandbox: FakeSandbox) {
  const lines = ["## main"];
  for (const [path, file] of [...sandbox.files].sort()) {
    const code = statusFor(file);
    if (code) lines.push(`${code} ${path}`);
  }
  return `${lines.join("\n")}\n`;
}

function unifiedDiff(sandbox: FakeSandbox) {
  const parts: string[] = [];
  for (const [path, file] of [...sandbox.files].sort()) {
    if (file.committed === null || file.contents === file.committed) continue;
    parts.push(
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      ...file.committed
        .split("\n")
        .filter(Boolean)
        .map((line) => `-${line}`),
      ...file.contents
        .split("\n")
        .filter(Boolean)
        .map((line) => `+${line}`),
    );
  }
  return parts.length ? `${parts.join("\n")}\n` : "";
}

/** Just enough shell to serve the commands the workbench actually runs. */
function runCommand(sandbox: FakeSandbox, command: string[]) {
  const [program, ...rest] = command;
  if (program === "find") {
    const paths = [...sandbox.files.keys()].sort().map((path) => `./${path}`);
    return { output: `${paths.join("\n")}\n`, exitCode: 0 };
  }
  if (program === "git" && rest[0] === "grep") {
    const query = rest.at(-1) ?? "";
    const matches: string[] = [];
    for (const [path, file] of [...sandbox.files].sort()) {
      file.contents.split("\n").forEach((line, index) => {
        if (query && line.includes(query)) {
          matches.push(`${path}:${index + 1}:${line}`);
        }
      });
    }
    return {
      output: matches.length ? `${matches.join("\n")}\n` : "",
      exitCode: matches.length ? 0 : 1,
    };
  }
  if (program === "git" && rest[0] === "show") {
    const path = (rest[1] ?? "").replace(/^HEAD:\.\//, "");
    const file = sandbox.files.get(path);
    if (!file || file.committed === null) return { output: "", exitCode: 128 };
    return { output: file.committed, exitCode: 0 };
  }
  return { output: "", exitCode: 0 };
}

/**
 * A scripted Codex turn that really edits the machine, so file-change cards
 * point at files that actually changed and the Git tab shows the diff.
 */
function scriptCodexTurn(sandbox: FakeSandbox, prompt: string) {
  const path = "NOTES.md";
  const existing = sandbox.files.get(path);
  const contents = `${existing?.contents ?? ""}- ${prompt.slice(0, 80)}\n`;
  sandbox.files.set(path, {
    contents,
    committed: existing?.committed ?? null,
  });
  const events = [
    { type: "thread.started", thread_id: "fake-thread" },
    { type: "turn.started" },
    {
      type: "item.started",
      item: { id: "item_0", type: "reasoning", text: "" },
    },
    {
      type: "item.completed",
      item: {
        id: "item_0",
        type: "reasoning",
        text: "**Looking at the repo**",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "bash -lc ls",
        aggregated_output: `${[...sandbox.files.keys()].join("\n")}\n`,
        exit_code: 0,
        status: "completed",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_2",
        type: "file_change",
        changes: [
          { path: `/workspace/${path}`, kind: existing ? "modify" : "add" },
        ],
        status: "completed",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_3",
        type: "agent_message",
        text: `Noted that in ${path}.`,
      },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: 42, cached_input_tokens: 0, output_tokens: 12 },
    },
  ];
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

/**
 * Recovers the member's words from the prompt argument.
 *
 * `buildGen2CodexCommand` puts a system preamble first, then a blank line,
 * then the turn. With prior history `formatGen2TurnPrompt` adds a "Current
 * request:" marker; without it the turn is simply the last paragraph.
 */
function promptFromCommand(command: string[]) {
  const last = command.at(-1) ?? "";
  const marker = "Current request:";
  const index = last.lastIndexOf(marker);
  if (index >= 0) return last.slice(index + marker.length).trim();
  const paragraphs = last.split(/\n\s*\n/).filter((part) => part.trim());
  return (paragraphs.at(-1) ?? last).trim();
}

/**
 * Handles an orchestrator call, or returns null when the path is outside what
 * Gen 2 uses -- callers then fall through to the real transport, which fails
 * loudly rather than pretending.
 */
export function handleFakeGuestRequest(
  method: string,
  path: string,
  body: unknown,
): Response | null {
  const payload = (body ?? {}) as Record<string, never>;

  if (method === "GET" && path === "/healthz") return json({ status: "ok" });

  if (method === "POST" && path === "/v1/sandboxes") {
    const workspaceId = String(
      (payload as Record<string, unknown>).workspaceId ?? "",
    );
    const sandbox = sandboxes.get(workspaceId) ?? seed(workspaceId);
    return json({
      sandbox: {
        id: sandbox.id,
        workspaceId,
        status: "ready",
        headSha: "0".repeat(40),
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
  }

  const match = /^\/v1\/sandboxes\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return null;
  const workspaceId = decodeURIComponent(match[1]!);
  const rest = match[2] ?? "";

  try {
    if (method === "GET" && rest === "") {
      const sandbox = require(workspaceId);
      return json({
        sandbox: {
          id: sandbox.id,
          workspaceId,
          status: "ready",
          headSha: "0".repeat(40),
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      });
    }
    if (method === "DELETE" && rest === "") {
      sandboxes.delete(workspaceId);
      return new Response(null, { status: 204 });
    }

    const sandbox = require(workspaceId);
    const input = payload as Record<string, string & number>;

    if (rest === "/files/read") {
      const file = sandbox.files.get(String(input.path));
      if (!file) return json({ error: "file not found" }, 404);
      return json({
        file: {
          path: input.path,
          contents: file.contents,
          revision: revisionOf(file.contents),
        },
      });
    }

    if (rest === "/files/write") {
      const existing = sandbox.files.get(String(input.path));
      const current = existing ? revisionOf(existing.contents) : "missing";
      if (current !== input.expectedRevision) {
        return json(
          { error: `revision mismatch: current revision is ${current}` },
          409,
        );
      }
      sandbox.files.set(String(input.path), {
        contents: String(input.contents),
        committed: existing?.committed ?? null,
      });
      return json({ revision: revisionOf(String(input.contents)) });
    }

    if (rest === "/pty/exec") {
      return json({
        result: runCommand(
          sandbox,
          (input as unknown as { command: string[] }).command,
        ),
      });
    }

    if (rest.startsWith("/git/")) {
      const operation = rest.slice("/git/".length).split("?")[0];
      if (operation === "status") return json({ output: porcelain(sandbox) });
      if (operation === "diff") return json({ output: unifiedDiff(sandbox) });
      return json({ error: "invalid Git action" }, 400);
    }

    if (rest === "/terminals") {
      sandbox.counter += 1;
      const sessionId = `term-${Date.now()}-${sandbox.counter}`;
      sandbox.terminals.set(sessionId, {
        chunks: [{ sequence: 1, data: "codev:/workspace$ " }],
        next: 2,
        exited: false,
        exitCode: null,
        cwd: "/workspace",
      });
      return json({ sessionId });
    }

    const terminal = /^\/terminals\/([^/]+)(\/.*)?$/.exec(rest);
    if (terminal) {
      const session = sandbox.terminals.get(terminal[1]!);
      if (!session) return json({ error: "terminal not found" }, 404);
      const action = terminal[2] ?? "";
      if (method === "DELETE") {
        sandbox.terminals.delete(terminal[1]!);
        return new Response(null, { status: 204 });
      }
      if (action === "/input") {
        const data = String(input.data ?? "");
        // Echo, then answer the handful of commands a smoke test types.
        session.chunks.push({ sequence: session.next++, data });
        if (data.includes("\r") || data.includes("\n")) {
          const line = data.replace(/[\r\n]+$/, "");
          const reply =
            line.trim() === "ls"
              ? `\r\n${[...sandbox.files.keys()].join("  ")}\r\n`
              : "\r\n";
          session.chunks.push({
            sequence: session.next++,
            data: `${reply}codev:/workspace$ `,
          });
        }
        return new Response(null, { status: 204 });
      }
      if (action === "/resize") return new Response(null, { status: 204 });
      if (action === "/poll") {
        const after = Number(input.after ?? 0);
        const chunks = session.chunks.filter((chunk) => chunk.sequence > after);
        return json({
          result: {
            chunks,
            nextSequence: session.next,
            exited: session.exited,
            exitCode: session.exitCode,
          },
        });
      }
    }

    if (rest === "/codex-execs") {
      sandbox.counter += 1;
      const sessionId = `codex-${sandbox.counter}`;
      const output = scriptCodexTurn(
        sandbox,
        promptFromCommand((input as unknown as { command: string[] }).command),
      );
      sandbox.execs.set(sessionId, {
        chunks: [
          {
            sequence: 0,
            dataBase64: Buffer.from(output, "utf8").toString("base64"),
          },
        ],
        next: 1,
        exited: true,
        exitCode: 0,
      });
      return json({ sessionId });
    }

    const exec = /^\/codex-execs\/([^/]+)(\/.*)?$/.exec(rest);
    if (exec) {
      const session = sandbox.execs.get(exec[1]!);
      if (!session) return json({ error: "codex exec not found" }, 404);
      if (method === "DELETE") {
        sandbox.execs.delete(exec[1]!);
        return new Response(null, { status: 204 });
      }
      const after = Number(input.after ?? 0);
      return json({
        result: {
          chunks: session.chunks.filter((chunk) => chunk.sequence >= after),
          nextSequence: session.next,
          exited: session.exited,
          exitCode: session.exitCode,
        },
      });
    }
  } catch (error) {
    if (error instanceof FakeGuestMissing) {
      return json({ error: "sandbox not found" }, 404);
    }
    throw error;
  }

  return null;
}
