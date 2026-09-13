import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "./api";
import { deleteProviderCredential } from "./credentials";
import { requireOrganizationSettingsWrite } from "./settings-access";

const scopeTypeSchema = z.enum(["USER", "ORGANIZATION"]);

/** Mirrors `disconnectHostedCodexConnection`
 *  (`hosted-codex-subscription-route.ts`) for the Claude CLI setup-token. */
export async function disconnectClaudeCliTokenConnection(request: Request) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    scopeType?: string;
    organizationId?: string;
  };
  const parsed = scopeTypeSchema.safeParse(body.scopeType ?? "USER");
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scope." }, { status: 400 });
  }
  const scopeType = parsed.data;
  const scopeId =
    scopeType === "ORGANIZATION" ? (body.organizationId ?? "") : user.id;
  try {
    if (scopeType === "ORGANIZATION") {
      await requireOrganizationSettingsWrite(user.id, scopeId);
    }
    await deleteProviderCredential(
      scopeType,
      scopeId,
      "anthropic",
      "OAUTH_TOKEN",
    );
    return NextResponse.json({
      status: "disconnected",
      kind: "claude_cli_token",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Disconnect failed." },
      { status: 403 },
    );
  }
}
