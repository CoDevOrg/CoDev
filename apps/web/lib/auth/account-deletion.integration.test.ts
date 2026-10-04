import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@codev/db";
import { createAccountDeletionToken } from "./account-deletion-token";

const state = vi.hoisted(() => ({ getDb: vi.fn(), deleteBilling: vi.fn() }));
vi.mock("../platform/database", () => ({ getDatabase: () => state.getDb() }));
vi.mock("../billing/delete-customer", () => ({
  deleteBillingCustomer: state.deleteBilling,
}));
vi.mock("../http/api-route", () => ({
  ApiError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
import { deleteAccount } from "./account-deletion";

const url = process.env.CODEV_DELETION_TEST_DATABASE_URL;
// This suite deliberately destroys fixture rows. Never accept a shared database.
if (
  url &&
  url !== "postgresql://codev_test@127.0.0.1:55439/codev_deletion_test"
)
  throw new Error("Use the isolated deletion test database only.");
const database = url ? createDatabase(url) : null;
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const email = "delete@example.test";
const query = (sql: string, values: unknown[] = []) =>
  database!.pool.query(sql, values);

describe.skipIf(!database)("account deletion against PostgreSQL", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "isolated-account-deletion-test-secret");
    state.getDb.mockReturnValue(database!.db);
    state.deleteBilling.mockReset().mockResolvedValue(undefined);
    await query(
      "TRUNCATE users, organizations, access_requests, provider_credentials CASCADE",
    );
    await query(
      "INSERT INTO plans(id,name) VALUES ('free','Free'),('pro','Individual') ON CONFLICT DO NOTHING",
    );
    await query(
      "INSERT INTO users(id,login,name,email,password_hash) VALUES ($1,'delete-me','Private Name',$3,'hash'),($2,'other','Collaborator','other@example.test',null)",
      [userId, otherId, email],
    );
    await query(
      "INSERT INTO organizations(id,slug,name) VALUES ($1,'private-org','Private Name')",
      [userId],
    );
    await query(
      "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$1,'owner')",
      [userId],
    );
    await query(
      "INSERT INTO organization_subscriptions(organization_id,plan_id,status,provider,provider_customer_id) VALUES($1,'pro','active','stripe','cus_test')",
      [userId],
    );
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.pool.end();
  });

  it("removes personal data and tokens, preserves shared history without the original identity, and cancels billing", async () => {
    await query(
      "INSERT INTO gen2_workspaces(id,owner_id,name) VALUES($1,$2,'Shared')",
      [workspaceId, otherId],
    );
    await query(
      "INSERT INTO gen2_workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'editor')",
      [workspaceId, otherId, userId],
    );
    await query(
      "INSERT INTO gen2_chats(workspace_id,created_by_user_id,title) VALUES($1,$2,'Shared work')",
      [workspaceId, userId],
    );
    await query(
      "INSERT INTO github_connections(user_id,encrypted_access_token) VALUES($1,'secret')",
      [userId],
    );
    await query(
      "INSERT INTO user_environment_variables(user_id,name,encrypted_value) VALUES($1,'TOKEN','secret')",
      [userId],
    );
    await query(
      "INSERT INTO cli_access_tokens(user_id,token_hash,expires_at) VALUES($1,'token',now()+interval '1 day')",
      [userId],
    );
    await query(
      "INSERT INTO provider_credentials(scope_type,scope_id,provider,credential_type,encrypted_api_key,created_by) VALUES('USER',$1,'openai','API_KEY','secret',$1)",
      [userId],
    );
    await query("INSERT INTO page_views(user_id,path) VALUES($1,'/settings')", [
      userId,
    ]);
    await query(
      "INSERT INTO access_requests(email,name) VALUES($1,'Private Name')",
      [email],
    );
    await query(
      "INSERT INTO conversations(owner_id,title) VALUES($1,'Private conversation')",
      [userId],
    );
    await deleteAccount(userId, createAccountDeletionToken(userId, email));
    expect(state.deleteBilling).toHaveBeenCalledWith("cus_test");
    expect(
      (await query("SELECT id FROM users WHERE id=$1", [userId])).rowCount,
    ).toBe(0);
    for (const table of [
      "github_connections",
      "user_environment_variables",
      "cli_access_tokens",
      "provider_credentials",
      "access_requests",
      "page_views",
      "conversations",
    ]) {
      expect((await query(`SELECT * FROM ${table}`)).rowCount, table).toBe(0);
    }
    const shared = await query(
      "SELECT u.name,u.email,u.password_hash,u.github_user_id FROM gen2_chats c JOIN users u ON u.id=c.created_by_user_id",
    );
    expect(shared.rows).toEqual([
      {
        name: "Deleted account",
        email: null,
        password_hash: null,
        github_user_id: null,
      },
    ]);
    expect(
      (await query("SELECT user_id FROM gen2_workspace_members")).rows,
    ).toEqual([{ user_id: otherId }]);
    expect(
      (
        await query(
          "SELECT status,provider_customer_id FROM organization_subscriptions",
        )
      ).rows,
    ).toEqual([{ status: "canceled", provider_customer_id: "cus_test" }]);
  });

  it("rejects a wrong or expired code before calling billing", async () => {
    await expect(
      deleteAccount(userId, createAccountDeletionToken(otherId, email)),
    ).rejects.toThrow("invalid or expired");
    expect(state.deleteBilling).not.toHaveBeenCalled();
    expect(
      (await query("SELECT id FROM users WHERE id=$1", [userId])).rowCount,
    ).toBe(1);
  });

  it("keeps owned workspace data and billing intact until the owner explicitly deletes it", async () => {
    await query(
      "INSERT INTO gen2_workspaces(owner_id,name) VALUES($1,'Keep this disk')",
      [userId],
    );
    await expect(
      deleteAccount(userId, createAccountDeletionToken(userId, email)),
    ).rejects.toThrow("owned workspaces");
    expect(state.deleteBilling).not.toHaveBeenCalled();
    expect((await query("SELECT id FROM gen2_workspaces")).rowCount).toBe(1);
  });

  it("does not erase the account when Stripe fails; a retry completes", async () => {
    state.deleteBilling.mockRejectedValueOnce(new Error("Stripe unavailable"));
    const token = createAccountDeletionToken(userId, email);
    await expect(deleteAccount(userId, token)).rejects.toThrow(
      "Stripe unavailable",
    );
    expect(
      (await query("SELECT email FROM users WHERE id=$1", [userId])).rows[0]
        .email,
    ).toBe(email);
    await deleteAccount(userId, token);
    expect(
      (await query("SELECT id FROM users WHERE id=$1", [userId])).rowCount,
    ).toBe(0);
  });
});
