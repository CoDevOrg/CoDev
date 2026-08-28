import { z } from "zod";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import {
  WorkspaceChatCoordinationError,
  acquireWorkspaceChatLease,
  heartbeatWorkspaceChat,
  leaveWorkspaceChat,
  loadWorkspaceChatSnapshot,
  recordWorkspaceChatPrompt,
  releaseWorkspaceChatLease,
  renewWorkspaceChatLease,
} from "@/lib/workspace-chat-coordination";

const chatIdSchema = z.string().trim().min(1).max(240);
const clientIdSchema = z.uuid();
const leaseTokenSchema = z.uuid();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("heartbeat"),
    chatId: chatIdSchema,
    clientId: clientIdSchema,
  }),
  z.object({
    action: z.literal("leave"),
    chatId: chatIdSchema,
    clientId: clientIdSchema,
  }),
  z.object({
    action: z.literal("acquire"),
    chatId: chatIdSchema,
    clientId: clientIdSchema,
  }),
  z.object({
    action: z.literal("renew"),
    chatId: chatIdSchema,
    clientId: clientIdSchema,
    leaseToken: leaseTokenSchema,
  }),
  z.object({
    action: z.literal("release"),
    chatId: chatIdSchema,
    clientId: clientIdSchema,
    leaseToken: leaseTokenSchema,
  }),
  z.object({
    action: z.literal("submit"),
    chatId: chatIdSchema,
    clientId: clientIdSchema,
    leaseToken: leaseTokenSchema,
    clientMessageId: z.uuid(),
    prompt: z.string().trim().max(20_000),
    attachments: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(255),
          type: z.string().trim().max(120),
        }),
      )
      .max(10),
    provider: z.enum(["claude", "codex"]),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    effort: z.string().trim().min(1).max(80).nullable().optional(),
  }),
]);

type Context = {
  params: Promise<{ workspaceId: string }>;
};

function coordinationError(error: unknown) {
  if (error instanceof WorkspaceChatCoordinationError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return apiError(error);
}

export async function GET(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const url = new URL(request.url);
    const chatId = chatIdSchema.parse(url.searchParams.get("chatId"));
    return Response.json(
      await loadWorkspaceChatSnapshot(workspaceId, chatId, user.id),
    );
  } catch (error) {
    return coordinationError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;

  try {
    const input = actionSchema.parse(await request.json());
    await requireWorkspacePermission(
      workspaceId,
      user.id,
      input.action === "heartbeat" || input.action === "leave"
        ? "view"
        : "coSteer",
    );

    if (input.action === "heartbeat") {
      await heartbeatWorkspaceChat(
        workspaceId,
        input.chatId,
        user.id,
        input.clientId,
      );
      return Response.json(
        await loadWorkspaceChatSnapshot(workspaceId, input.chatId, user.id),
      );
    }
    if (input.action === "leave") {
      await leaveWorkspaceChat(
        workspaceId,
        input.chatId,
        user.id,
        input.clientId,
      );
      return new Response(null, { status: 204 });
    }
    if (input.action === "acquire") {
      const lease = await acquireWorkspaceChatLease(
        workspaceId,
        input.chatId,
        user.id,
        input.clientId,
      );
      return Response.json({
        ...(await loadWorkspaceChatSnapshot(
          workspaceId,
          input.chatId,
          user.id,
        )),
        leaseToken: lease.leaseToken,
      });
    }
    if (input.action === "renew") {
      await renewWorkspaceChatLease({
        workspaceId,
        chatId: input.chatId,
        userId: user.id,
        clientId: input.clientId,
        leaseToken: input.leaseToken,
      });
      return Response.json(
        await loadWorkspaceChatSnapshot(workspaceId, input.chatId, user.id),
      );
    }
    if (input.action === "release") {
      await releaseWorkspaceChatLease({
        workspaceId,
        chatId: input.chatId,
        userId: user.id,
        clientId: input.clientId,
        leaseToken: input.leaseToken,
      });
      return Response.json(
        await loadWorkspaceChatSnapshot(workspaceId, input.chatId, user.id),
      );
    }

    const receipt = await recordWorkspaceChatPrompt({
      workspaceId,
      chatId: input.chatId,
      userId: user.id,
      clientId: input.clientId,
      leaseToken: input.leaseToken,
      clientMessageId: input.clientMessageId,
      prompt: input.prompt,
      attachments: input.attachments,
      provider: input.provider,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.effort !== undefined ? { effort: input.effort } : {}),
    });
    return Response.json({
      ...(await loadWorkspaceChatSnapshot(workspaceId, input.chatId, user.id)),
      receiptId: receipt.id,
    });
  } catch (error) {
    return coordinationError(error);
  }
}
