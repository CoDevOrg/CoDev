import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { registerPushToken, unregisterPushToken } from "@/lib/api-client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Requests permission, fetches an Expo push token, and registers it with the
 * backend. Requires an EAS project id (from `eas init`) to mint a token —
 * until the app has one, this no-ops with a console warning rather than
 * crashing, since push distribution is a later-stage concern (see the plan's
 * "Explicitly deferred" section on EAS/App Store credentials).
 */
export async function registerForPushNotifications() {
  if (!Device.isDevice) {
    console.warn("Push notifications require a physical device or a dev-client build in Simulator.");
    return;
  }
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as
    | string
    | undefined;
  if (!projectId) {
    console.warn("No EAS project id configured yet — skipping push token registration.");
    return;
  }

  try {
    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    await registerPushToken({
      expoPushToken,
      platform: Platform.OS === "ios" ? "ios" : "android",
      deviceId: Constants.deviceId ?? undefined,
    });
    return expoPushToken;
  } catch (error) {
    console.warn("Failed to register push token", error);
    return undefined;
  }
}

export async function unregisterCurrentPushToken(expoPushToken: string) {
  await unregisterPushToken(expoPushToken).catch(() => undefined);
}

export type NotificationDeepLinkData = {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
};

export function extractDeepLinkData(
  response: Notifications.NotificationResponse,
): NotificationDeepLinkData {
  const data = response.notification.request.content.data as
    | NotificationDeepLinkData
    | undefined;
  return { workspaceId: data?.workspaceId, sessionId: data?.sessionId };
}
