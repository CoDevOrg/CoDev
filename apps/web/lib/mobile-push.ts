import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

let expo: Expo | undefined;
function getExpoClient() {
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  expo ??= new Expo(accessToken ? { accessToken } : {});
  return expo;
}

export type AgentNotificationReason = "idle" | "failed" | "waiting_review";

function notificationCopy(
  sessionName: string,
  reason: AgentNotificationReason,
  extra?: { lastError?: string },
) {
  switch (reason) {
    case "idle":
      return {
        title: "Agent finished",
        body: `${sessionName} finished its turn.`,
      };
    case "failed":
      return {
        title: "Agent failed",
        body: extra?.lastError
          ? `${sessionName} failed: ${extra.lastError.slice(0, 140)}`
          : `${sessionName} failed.`,
      };
    case "waiting_review":
      return {
        title: "Ready for review",
        body: `${sessionName} is ready for your review.`,
      };
  }
}

/**
 * Sends an Expo push notification to every mobile device registered by a
 * workspace's owner/co_steer members. Called from the three real
 * `agentSessions.status` transition sites: the confirmed-empty-queue path in
 * `claimNextAgentTurn` ("idle"), `failAgentSession` ("failed"), and
 * `stopAgentForReview` ("waiting_review"). Best-effort: a delivery failure
 * must never fail the caller's transaction.
 */
export async function notifyWorkspaceMembers(
  workspaceId: string,
  sessionId: string,
  reason: AgentNotificationReason,
  extra?: { lastError?: string },
) {
  try {
    const database = getDatabase();
    const [session] = await database
      .select({ name: schema.agentSessions.name })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.id, sessionId))
      .limit(1);
    if (!session) return;

    const recipients = await database
      .select({ expoPushToken: schema.mobilePushTokens.expoPushToken })
      .from(schema.workspaceMembers)
      .innerJoin(
        schema.mobilePushTokens,
        eq(schema.mobilePushTokens.userId, schema.workspaceMembers.userId),
      )
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          inArray(schema.workspaceMembers.accessRole, ["owner", "co_steer"]),
        ),
      );
    if (recipients.length === 0) return;

    const { title, body } = notificationCopy(session.name, reason, extra);
    const data = { workspaceId, sessionId, reason };
    const messages: ExpoPushMessage[] = recipients
      .filter((recipient) => Expo.isExpoPushToken(recipient.expoPushToken))
      .map((recipient) => ({
        to: recipient.expoPushToken,
        title,
        body,
        data,
        sound: "default",
      }));
    if (messages.length === 0) return;

    const client = getExpoClient();
    const chunks = client.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await client.sendPushNotificationsAsync(chunk);
    }
  } catch (error) {
    console.error("notifyWorkspaceMembers failed", { workspaceId, sessionId, reason, error });
  }
}

export async function registerMobilePushToken(input: {
  userId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  deviceId?: string | undefined;
}) {
  const database = getDatabase();
  await database
    .insert(schema.mobilePushTokens)
    .values({
      userId: input.userId,
      expoPushToken: input.expoPushToken,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
    })
    .onConflictDoUpdate({
      target: schema.mobilePushTokens.expoPushToken,
      set: {
        userId: input.userId,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function unregisterMobilePushToken(expoPushToken: string) {
  await getDatabase()
    .delete(schema.mobilePushTokens)
    .where(eq(schema.mobilePushTokens.expoPushToken, expoPushToken));
}
