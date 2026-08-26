/**
 * Base URL of the CoDev web app's API. Set EXPO_PUBLIC_API_BASE_URL for a
 * real deployment; the iOS Simulator can reach a local `apps/web` dev server
 * directly via localhost, which is the default for development.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
