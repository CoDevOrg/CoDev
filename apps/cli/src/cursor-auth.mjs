import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  authenticatedRequest,
  loadConfig,
  organizationSharingWarning,
  resolveOrganization,
  run,
} from "./client.mjs";

/** Paths `agent login` may write when the credential store is a file. */
export function cursorAuthFileCandidates(home) {
  return [
    join(home, ".cursor", "auth.json"),
    join(home, ".config", "cursor", "auth.json"),
  ];
}

async function readCursorAuthFile(home) {
  for (const path of cursorAuthFileCandidates(home)) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    "Could not read Cursor's auth.json after `agent login`. Run it again with the file credential store.",
  );
}

export async function cursorAuth({
  organization = false,
  organizationId,
} = {}) {
  await loadConfig();
  if (organization) {
    process.stdout.write(organizationSharingWarning("Cursor"));
  }
  const home = await mkdtemp(join(tmpdir(), "codev-cursor-auth-"));
  await chmod(home, 0o700);
  try {
    process.stdout.write("Starting the official Cursor CLI login…\n");
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      AGENT_CLI_CREDENTIAL_STORE: "file",
    };
    delete env.CURSOR_API_KEY;
    await run("agent", ["login"], { env });
    await uploadCursorAuth(home, organization, organizationId);
    process.stdout.write(
      organization
        ? "Cursor is connected to the CoDev organization — shared with every member of that workspace.\n"
        : "Cursor is connected to your CoDev account.\n",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function uploadCursorAuth(home, organization, organizationId) {
  const auth = await readCursorAuthFile(home);
  const resolvedOrganizationId = organization
    ? await resolveOrganization(organizationId)
    : undefined;
  await authenticatedRequest("/api/cli/cursor-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scopeType: organization ? "ORGANIZATION" : "USER",
      ...(resolvedOrganizationId
        ? { organizationId: resolvedOrganizationId }
        : {}),
      auth,
    }),
  });
}
