import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { HostedCodexScopeType } from "@codev/shared-types";

import { getApiUser } from "./api";
import {
  disconnectHostedCodexSubscription,
  getHostedCodexPublicStatus,
} from "./hosted-codex-subscription-credentials";
import { requireOrganizationSettingsWrite } from "./settings-access";

const scopeTypeSchema = z.enum(["USER", "ORGANIZATION"]);

export async function disconnectHostedCodexConnection(request: Request) {
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
    await disconnectHostedCodexSubscription({
      userId: user.id,
      scopeType,
      scopeId,
    });
    return NextResponse.json({
      status: "disconnected",
      kind: "hosted_codex_subscription",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Disconnect failed." },
      { status: 403 },
    );
  }
}

export async function hostedCodexStatusResponse(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
  canManage: boolean;
}) {
  return NextResponse.json(await getHostedCodexPublicStatus(input));
}
