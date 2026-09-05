import { afterEach, describe, expect, it, vi } from "vitest";

const database = {
  select: vi.fn(),
};

vi.mock("./database", () => ({
  getDatabase: () => database,
}));

import {
  getWorkspaceAccess,
  requireWorkspacePermission,
  writeWorkspaceTuple,
} from "./access";

const membership = {
  accessRole: "co_steer" as const,
  legacyRole: "member" as const,
  canTerminal: true,
  canMerge: true,
};

function configureMembership() {
  database.select.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: async () => [membership],
        }),
      }),
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("OpenFGA workspace authorization", () => {
  it("denies a permission when OpenFGA denies the mapped relation", async () => {
    configureMembership();
    vi.stubEnv("OPENFGA_API_URL", "https://fga.test");
    vi.stubEnv("OPENFGA_STORE_ID", "store-1");
    vi.stubEnv("OPENFGA_AUTHORIZATION_MODEL_ID", "model-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ allowed: false }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ allowed: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requireWorkspacePermission(
        "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
        "edit",
      ),
    ).rejects.toMatchObject({ status: 403 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.tuple_key).toMatchObject({
      user: "user:2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      relation: "editor",
      object: "workspace:e010bd2c-a3c1-438f-acef-166287a3b1cb",
    });
  });

  it("repairs a missing tuple for an existing database membership", async () => {
    configureMembership();
    vi.stubEnv("OPENFGA_API_URL", "https://fga.test");
    vi.stubEnv("OPENFGA_STORE_ID", "store-1");
    vi.stubEnv("OPENFGA_AUTHORIZATION_MODEL_ID", "model-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ allowed: false }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ allowed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getWorkspaceAccess(
        "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      ),
    ).resolves.toMatchObject({ role: "co_steer" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const writeBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(writeBody.writes.tuple_keys).toEqual([
      {
        user: "user:2f2387ed-4a63-4b05-88cc-266d65f7b82b",
        relation: "editor",
        object: "workspace:e010bd2c-a3c1-438f-acef-166287a3b1cb",
      },
    ]);
  });

  it("repairs a stale lower role before granting an upgraded membership", async () => {
    const upgradedMembership = {
      ...membership,
      accessRole: "reviewer" as const,
      canMerge: false,
    };
    database.select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [upgradedMembership],
          }),
        }),
      }),
    });
    vi.stubEnv("OPENFGA_API_URL", "https://fga.test");
    vi.stubEnv("OPENFGA_STORE_ID", "store-1");
    vi.stubEnv("OPENFGA_AUTHORIZATION_MODEL_ID", "model-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ allowed: false }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ allowed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getWorkspaceAccess(
        "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      ),
    ).resolves.toMatchObject({ role: "reviewer" });

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstRequest.tuple_key.relation).toBe("reviewer");
    const writeBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(writeBody.writes.tuple_keys[0].relation).toBe("reviewer");
  });

  it("fails closed when production has no OpenFGA configuration", async () => {
    configureMembership();
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      getWorkspaceAccess(
        "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("writes co-steer tuples as editor relationships", async () => {
    vi.stubEnv("OPENFGA_API_URL", "https://fga.test");
    vi.stubEnv("OPENFGA_STORE_ID", "store-1");
    vi.stubEnv("OPENFGA_AUTHORIZATION_MODEL_ID", "model-1");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    await writeWorkspaceTuple({
      workspaceId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      userId: "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      role: "co_steer",
      deleteRole: "viewer",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.writes.tuple_keys).toEqual([
      {
        user: "user:2f2387ed-4a63-4b05-88cc-266d65f7b82b",
        relation: "editor",
        object: "workspace:e010bd2c-a3c1-438f-acef-166287a3b1cb",
      },
    ]);
    expect(requestBody.deletes.tuple_keys).toEqual([
      {
        user: "user:2f2387ed-4a63-4b05-88cc-266d65f7b82b",
        relation: "viewer",
        object: "workspace:e010bd2c-a3c1-438f-acef-166287a3b1cb",
      },
    ]);
  });

  it("omits empty tuple deletes for Auth0 FGA writes", async () => {
    vi.stubEnv("OPENFGA_API_URL", "https://fga.test");
    vi.stubEnv("OPENFGA_STORE_ID", "store-1");
    vi.stubEnv("OPENFGA_AUTHORIZATION_MODEL_ID", "model-1");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    await writeWorkspaceTuple({
      workspaceId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      userId: "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      role: "owner",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.deletes).toBeUndefined();
  });

  it("exchanges Auth0 FGA client credentials before calling the API", async () => {
    vi.stubEnv("OPENFGA_API_URL", "https://api.us1.fga.dev");
    vi.stubEnv("OPENFGA_STORE_ID", "store-1");
    vi.stubEnv("OPENFGA_AUTHORIZATION_MODEL_ID", "model-1");
    vi.stubEnv("OPENFGA_CLIENT_ID", "client-1");
    vi.stubEnv("OPENFGA_CLIENT_SECRET", "client-secret-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "access-token-1", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(Response.json({ allowed: true }))
      .mockResolvedValueOnce(Response.json({ allowed: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requireWorkspacePermission(
        "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
        "view",
      ),
    ).resolves.toMatchObject({ role: "co_steer" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://auth.fga.dev/oauth/token",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      client_id: "client-1",
      client_secret: "client-secret-1",
      audience: "https://api.us1.fga.dev/",
      grant_type: "client_credentials",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer access-token-1",
    });
  });
});
