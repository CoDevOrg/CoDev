import { afterEach, describe, expect, it, vi } from "vitest";

import { createClientSecretCredential } from "./azure";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createClientSecretCredential", () => {
  it("exchanges the client secret once and reuses the token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: "vault-token", expires_in: 3600 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const credential = createClientSecretCredential(
      "tenant",
      "client",
      "secret",
    );
    const first = await credential.getToken("https://vault.azure.net/.default");
    const second = await credential.getToken(
      "https://vault.azure.net/.default",
    );

    expect(first?.token).toBe("vault-token");
    expect(second?.token).toBe("vault-token");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    );
    expect(String(init.body)).toContain("grant_type=client_credentials");
    expect(String(init.body)).toContain("client_id=client");
  });

  it("refuses a failed token response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    const credential = createClientSecretCredential(
      "tenant",
      "client",
      "secret",
    );
    await expect(
      credential.getToken("https://vault.azure.net/.default"),
    ).rejects.toThrow("Azure credentials are not configured for Cloudflare.");
  });
});
