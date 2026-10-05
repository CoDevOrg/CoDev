import "server-only";
import { env } from "cloudflare:workers";

/** Prefer live Worker bindings; Vercel supplies runtime variables through Node. */
export function runtimeEnvironment() {
  const bindings = Object.fromEntries(
    Object.entries(env).filter(([, value]) => typeof value === "string"),
  ) as Record<string, string>;
  return { ...process.env, ...bindings };
}
