import { describe, expect, it } from "vitest";
import { cursorLaunchSecret } from "./cursor-launch-secret";
import { launchProfileFor } from "./registry";

describe("Cursor stored authentication", () => {
  it("preserves the CLI refresh token and uses its file store", () => {
    const contents = JSON.stringify({
      accessToken: "cursor-access-token-value-0001",
      refreshToken: "distinct-refresh-token",
    });
    const secret = cursorLaunchSecret(contents)!;
    expect(secret).toEqual({
      kind: "cursor_auth_cache",
      authCacheJson: contents,
    });
    expect(launchProfileFor("cursor", secret).env?.CURSOR_AUTH_TOKEN).toBe("");
  });
  it("passes a legacy session token privately to Cursor's auth-token path", () => {
    const token = "header.payload.signature";
    const secret = cursorLaunchSecret(token)!;
    expect(launchProfileFor("cursor", secret).env?.CURSOR_AUTH_TOKEN).toBe(
      token,
    );
    expect(
      JSON.parse(launchProfileFor("cursor", secret).files![0]!.contents),
    ).toEqual({ accessToken: token, refreshToken: token });
  });
  it("rejects corrupt stored material", () => {
    expect(cursorLaunchSecret("not JSON or a token")).toBeNull();
    expect(cursorLaunchSecret("{}")).toBeNull();
  });
});
