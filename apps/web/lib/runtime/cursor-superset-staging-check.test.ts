// TEMPORARY verification for PR #136 on a staging VM. Not committed.
import { appendFileSync } from "node:fs";
import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  ArmWorkspaceProvider,
  capabilityToken,
} from "./arm-workspace-provider";

const LOG = process.env.CHECK_LOG ?? "/tmp/cursor-superset-check.log";
const log = (line: string) => appendFileSync(LOG, `${line}\n`);
const q = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const asShell = "setpriv --reuid=2000 --regid=2000 --clear-groups --";
const bridge = (method: string, path: string, body?: unknown) =>
  `. /etc/codev/superset-bridge.env; printf 'x-codev-bridge-secret: %s\\n' "$CODEV_SUPERSET_BRIDGE_SECRET" | curl -sS -X ${method} -H @- -H 'content-type: application/json' ${body === undefined ? "" : `--data ${q(JSON.stringify(body))}`} http://127.0.0.1:4879${path}; echo`;
const cursorCommand = [
  "cursor-agent",
  "--print",
  "--output-format",
  "stream-json",
  "--force",
  "--trust",
  "--disable-project-configs",
  "--model",
  "auto",
  "Run: echo hello",
];
const cursorProfile = {
  env: {
    HOME: "{{profileDir}}",
    XDG_CONFIG_HOME: "{{profileDir}}/.config",
    CURSOR_CONFIG_DIR: "{{profileDir}}/.config/cursor",
    CURSOR_DATA_DIR: "{{profileDir}}/.cursor",
    AGENT_CLI_CREDENTIAL_STORE: "file",
  },
};

it.skipIf(!process.env.CODEV_ARM_CANARY_CREDENTIAL_DIR)(
  "launches Cursor as a Superset agent on a staging VM",
  async () => {
    const directory = process.env.CODEV_ARM_CANARY_CREDENTIAL_DIR!;
    const credential = JSON.parse(
      await readFile(join(directory, "azure-client-credential.json"), "utf8"),
    );
    const cloudflare = JSON.parse(
      await readFile(join(directory, "token-response.json"), "utf8"),
    );
    Object.assign(process.env, {
      AZURE_TENANT_ID: credential.tenant,
      AZURE_SUBSCRIPTION_ID: "8ad43e43-af64-4d36-afc5-5e01b23833e4",
      ARM_WORKSPACE_AZURE_CLIENT_ID: credential.appId,
      ARM_WORKSPACE_AZURE_CLIENT_SECRET: credential.password,
      ARM_WORKSPACE_RESOURCE_GROUP: "codev-arm-workspace-staging",
      ARM_WORKSPACE_IMAGE_VERSION_ID:
        process.env.CODEV_ARM_CANARY_IMAGE_VERSION_ID,
      ARM_WORKSPACE_SSH_PUBLIC_KEY: await readFile(
        join(directory, "ssh-ed25519.pub"),
        "utf8",
      ),
      ARM_WORKSPACE_SIGNING_PRIVATE_KEY: createPrivateKey(
        await readFile(join(directory, "signing-private.pem")),
      )
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
      ARM_WORKSPACE_SIGNING_PUBLIC_KEY: await readFile(
        join(directory, "signing-public.pem"),
        "utf8",
      ),
      CLOUDFLARE_API_TOKEN: cloudflare.value,
    });

    const provider = new ArmWorkspaceProvider();
    const workspaceId = randomUUID();
    const generation = 1;
    let resources: { diskId: string | null; diskUuid: string | null } = {
      diskId: null,
      diskUuid: null,
    };
    try {
      const started = await provider.start(
        { workspaceId, generation, ...resources },
        async (status, update) => {
          resources = { ...resources, ...update };
          log(`vm: ${status}`);
        },
      );
      resources = started;
      const host = started.routeHost;
      const call = async (method: string, path: string, body?: unknown) => {
        const encoded = body === undefined ? "" : JSON.stringify(body);
        const request = { method, path, scope: "workspace", body: encoded };
        const token = await capabilityToken(
          host,
          workspaceId,
          generation,
          request,
        );
        const response = await fetch(`https://${host}${path}`, {
          method,
          ...(body === undefined ? {} : { body: encoded }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          signal: AbortSignal.timeout(60_000),
        });
        return {
          status: response.status,
          payload: (await response.json().catch(() => null)) as Record<
            string,
            unknown
          > | null,
        };
      };
      const run = async (label: string, shell: string) => {
        const { status, payload } = await call("POST", "/v1/pty/exec", {
          command: ["sh", "-ec", shell],
          workingDir: "",
          timeoutSeconds: 30,
        });
        const result = (payload?.result ?? payload) as {
          output: string;
          exitCode: number;
        };
        log(
          `--- ${label} (http ${status}, exit ${result?.exitCode})\n${result?.output ?? JSON.stringify(payload)}`,
        );
        return result;
      };

      expect(
        (
          await call("POST", "/v1/workspace/initialize", {
            repositoryUrl: null,
            baseSha: "0".repeat(40),
            complete: true,
          })
        ).status,
      ).toBe(200);
      await run(
        "base commit",
        `cd /workspace && printf 'hello\\n' > README.md && ${asShell} git -c user.email=t@t -c user.name=t -c safe.directory=* add README.md && ${asShell} git -c user.email=t@t -c user.name=t -c safe.directory=* commit -qm base`,
      );
      await run(
        "worktree",
        bridge("POST", "/codev/worktrees", {
          worktreeId: "agent-cursor",
          branch: "agent-cursor",
        }),
      );

      const start = (extra: Record<string, unknown> = {}) =>
        call("POST", "/v1/superset-agents", {
          codevRunId: randomUUID(),
          codevWorkspaceId: workspaceId,
          worktreeId: "agent-cursor",
          provider: "cursor",
          launchProfile: cursorProfile,
          command: cursorCommand,
          idempotencyKey: randomUUID(),
          coordination: true,
          ...extra,
        });

      const launched = await start();
      log(
        `--- superset cursor start: http ${launched.status} ${JSON.stringify(launched.payload)}`,
      );
      expect(launched.status).toBe(201);
      const agentId = String(launched.payload?.hostAgentSessionId);

      const profile = await run(
        "private profile hooks",
        'for f in /var/lib/codev/codev-agent-profiles/agent-*/.cursor/hooks.json; do stat -c \'%u:%g %a %n\' "$f"; cat "$f"; echo; done',
      );
      expect(profile.output).toContain("/codev/coordination/notices");
      expect(profile.output).toContain('"version":1');
      expect(profile.output).not.toMatch(/^0:/m);

      await new Promise((resolve) => setTimeout(resolve, 8_000));
      const polled = await call("POST", `/v1/superset-agents/${agentId}/poll`, {
        after: 0,
      });
      log(
        `--- cursor terminal output: http ${polled.status} ${JSON.stringify(polled.payload).slice(0, 1500)}`,
      );
      expect(polled.status).toBe(200);
      const closed = await call("DELETE", `/v1/superset-agents/${agentId}`);
      log(`--- close: http ${closed.status}`);

      await run(
        "plant repo hook",
        `${asShell} sh -c 'mkdir -p /workspace/.git/codev-agent-worktrees/agent-cursor/.cursor && printf {} > /workspace/.git/codev-agent-worktrees/agent-cursor/.cursor/hooks.json'`,
      );
      const refused = await start();
      log(
        `--- start beside repo hook: http ${refused.status} ${JSON.stringify(refused.payload)}`,
      );
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.payload)).toContain(".cursor/hooks.json");
    } finally {
      await provider.stop({ workspaceId, generation, ...resources });
      const diskId =
        resources.diskId ??
        `/subscriptions/${process.env.AZURE_SUBSCRIPTION_ID}/resourceGroups/codev-arm-workspace-staging/providers/Microsoft.Compute/disks/codev-ws-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 16)}-data`;
      await provider.deleteDisk(diskId, workspaceId);
      log("vm: cleaned");
    }
  },
  1_800_000,
);
