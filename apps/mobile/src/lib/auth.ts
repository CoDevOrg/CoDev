import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { API_BASE_URL } from "@/lib/config";

const TOKEN_KEY = "codev_mobile_token";

// expo-secure-store has no web implementation (iOS Keychain / Android
// Keystore have no web equivalent); the app only ships to iOS and Android,
// but this guard keeps `expo start --web` usable for quick iteration.
const isWeb = Platform.OS === "web";

export async function getStoredToken() {
  if (isWeb) return null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function storeToken(token: string) {
  if (isWeb) return;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearStoredToken() {
  if (isWeb) return;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export type OAuthProvider = "github" | "google";

export const OAUTH_CALLBACK_URL = "codevmobile://auth-callback";

/** URL to open in an in-app auth sheet — starts the real GitHub/Google OAuth flow. */
export function getOAuthStartUrl(provider: OAuthProvider): string {
  return `${API_BASE_URL}/api/mobile/auth/start/${provider}`;
}

/** Parses the `codevmobile://auth-callback?...` URL the auth sheet redirects to, and stores the token. */
export async function completeOAuthCallback(resultUrl: string): Promise<void> {
  const url = new URL(resultUrl);
  const error = url.searchParams.get("error");
  if (error) throw new Error(error);
  const token = url.searchParams.get("token");
  if (!token) throw new Error("Sign-in did not return a token.");
  await storeToken(token);
}

export async function signInWithCredentials(input: {
  intent: "sign-in" | "sign-up";
  email: string;
  password: string;
  name?: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/mobile/auth/credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? "Could not sign in.");
  }
  const result = (await response.json()) as { token: string };
  await storeToken(result.token);
}
