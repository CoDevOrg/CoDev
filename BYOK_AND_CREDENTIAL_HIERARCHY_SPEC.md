# BYOK_AND_CREDENTIAL_HIERARCHY_SPEC.md

> **Document Scope:** Specification for Bring Your Own Key (BYOK), Credential Hierarchy Resolution, OAuth Integrations (Claude Code & Codex), and Key Storage Encryption for **CoDev**.

---

## 1. Credential Resolution Hierarchy

Whenever a user or AI agent executes a prompt inside a CoDev workspace, the system resolves API keys and OAuth tokens using a strict 3-tier fallback hierarchy.

```text
┌──────────────────────────────────────────┐
│  1. USER PERSONAL CREDENTIAL (Highest)   │ ──► User's personal API Key or OAuth Token
└────────────────────┬─────────────────────┘
                     │ If Unset
                     ▼
┌──────────────────────────────────────────┐
│  2. WORKSPACE / ORG SHARED POOL          │ ──► Team Shared Key / Azure / Bedrock Role
└────────────────────┬─────────────────────┘
                     │ If Unset
                     ▼
┌──────────────────────────────────────────┐
│  3. PLATFORM FALLBACK / TRIAL POOL       │ ──► CoDev Platform Key (Rate-Limited)
└──────────────────────────────────────────┘

```

- **Personal Override:** If a user connects their own Claude Code OAuth or OpenAI API Key, all of their prompts utilize their own credits and bypass platform rate limits.
- **Seamless Teammate Fallback:** If a teammate hasn't set up personal keys, the agent automatically falls back to the workspace/organization pool so collaboration is never blocked.

---

## 2. OAuth Authentication Flows (Claude Code & Codex)

For tools using browser-based OAuth authentication (Claude Code, Codex) instead of raw API keys, CoDev uses an **OAuth 2.0 Authorization Code Flow with PKCE** managed via **Nango** or a dedicated OAuth handler.

```text
┌───────────────┐          ┌──────────────────────────┐          ┌─────────────────────────┐
│ CODEV FRONTEND│ ───────► │ CODEV OAUTH / NANGO VAULT │ ───────► │ PROVIDER (Anthropic/    │
│  (Next.js)    │ ◄─────── │  (PKCE Code Exchange)    │ ◄─────── │  OpenAI Codex Endpoint) │
└───────────────┘          └────────────┬─────────────┘          └─────────────────────────┘
                                        │
                                        ▼ Encrypted Tokens
                           ┌──────────────────────────┐
                           │   POSTGRES DB (KMS)      │
                           │ access_token             │
                           │ refresh_token + expiry   │
                           └──────────────────────────┘

```

### A. Claude Code OAuth Flow (`/api/auth/oauth/claude`)

1. **Initiation:** User clicks **"Connect Claude Code"** in `/settings/personal/agents` or `/settings/org/agents`.
2. **PKCE Challenge:** The server generates a PKCE `code_verifier` and redirects the user to the Anthropic OAuth authorization URL with requested scopes (`claude_code:write`, `user:profile`).
3. **Callback & Token Exchange:** Anthropic redirects back to `/api/auth/oauth/claude/callback` with an auth code. The server exchanges this code for:

- `access_token`
- `refresh_token`
- `expires_in` (seconds)

4. **Encryption & Storage:** Tokens are encrypted via **AWS KMS** and stored in the database.
5. **Auto-Refresh Middleware:** Before dispatching an agent request, if `expiresAt < Date.now() + 5 minutes`, the backend uses the `refresh_token` to fetch a fresh `access_token` automatically.

### B. Codex OAuth Flow (`/api/auth/oauth/codex`)

1. **Initiation:** User selects **"Connect Codex OAuth"**.
2. **Authorization:** Redirects user to the OpenAI / Codex OAuth portal requesting organizational code execution and completion scopes.
3. **Token Exchange:** Backend exchanges authorization code for bearer token pairs (`access_token` and `refresh_token`).
4. **Header Injection:** Injected directly into the Vercel AI SDK HTTP transport headers (`Authorization: Bearer <access_token>`) when executing Codex agent steps.

---

## 3. Database Schema (`/packages/shared-types/src/credentials.ts`)

```typescript
export type AuthProvider =
  | "anthropic"
  | "openai"
  | "bedrock"
  | "azure_foundry"
  | "cursor"
  | "custom";
export type CredentialType =
  | "API_KEY"
  | "OAUTH_TOKEN"
  | "AWS_BEDROCK_ROLE"
  | "AZURE_ENDPOINT";
export type ScopeType = "USER" | "WORKSPACE";

export interface ProviderCredential {
  id: string;
  scopeType: ScopeType;
  scopeId: string; // userId or workspaceId
  provider: AuthProvider;
  credentialType: CredentialType;
  priorityOrder: number; // Priority order within provider family

  // Encrypted Payload (AWS KMS Envelope Encryption)
  encryptedApiKey?: string; // Used when credentialType === 'API_KEY'
  encryptedAccessToken?: string; // Used when credentialType === 'OAUTH_TOKEN'
  encryptedRefreshToken?: string; // Used for OAuth token auto-refresh
  expiresAt?: string; // ISO string for OAuth access token expiration

  // AWS Bedrock / Azure Foundry metadata
  endpointUrl?: string; // Azure Foundry base URL
  awsRoleArn?: string; // Bedrock IAM Role ARN

  isConnected: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. Backend Resolution Middleware (`/apps/hocuspocus-server/src/agent/credentials.ts`)

```typescript
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";

interface ResolvedCredential {
  apiKeyOrToken: string;
  source: "USER" | "WORKSPACE" | "PLATFORM";
  authType: CredentialType;
}

export async function resolveAgentCredential(
  userId: string,
  workspaceId: string,
  provider: AuthProvider,
): Promise<ResolvedCredential> {
  // 1. Check User Personal Credentials (Highest Priority)
  const userCred = await db.credentials.findFirst({
    where: { scopeType: "USER", scopeId: userId, provider, isConnected: true },
    orderBy: { priorityOrder: "asc" },
  });

  if (userCred) {
    const token = await getValidTokenOrRefresh(userCred);
    return {
      apiKeyOrToken: token,
      source: "USER",
      authType: userCred.credentialType,
    };
  }

  // 2. Fallback to Workspace Credentials
  const workspaceCred = await db.credentials.findFirst({
    where: {
      scopeType: "WORKSPACE",
      scopeId: workspaceId,
      provider,
      isConnected: true,
    },
    orderBy: { priorityOrder: "asc" },
  });

  if (workspaceCred) {
    const token = await getValidTokenOrRefresh(workspaceCred);
    return {
      apiKeyOrToken: token,
      source: "WORKSPACE",
      authType: workspaceCred.credentialType,
    };
  }

  // 3. Fallback to CoDev Platform Key
  if (process.env.PLATFORM_FALLBACK_API_KEY) {
    return {
      apiKeyOrToken: process.env.PLATFORM_FALLBACK_API_KEY,
      source: "PLATFORM",
      authType: "API_KEY",
    };
  }

  throw new Error(
    `No valid API Key or OAuth credentials found for ${provider}. Please connect a key in Settings.`,
  );
}

async function getValidTokenOrRefresh(
  cred: ProviderCredential,
): Promise<string> {
  if (cred.credentialType === "API_KEY") {
    return await decryptWithKMS(cred.encryptedApiKey!);
  }

  // Handle OAuth Token Expiration & Auto-Refresh
  const isExpired =
    cred.expiresAt &&
    new Date(cred.expiresAt).getTime() < Date.now() + 5 * 60 * 1000;

  if (isExpired && cred.encryptedRefreshToken) {
    const refreshToken = await decryptWithKMS(cred.encryptedRefreshToken);
    const newTokens = await refreshOAuthTokens(cred.provider, refreshToken);

    // Save updated tokens encrypted to Database
    await updateCredentialTokens(cred.id, newTokens);
    return newTokens.accessToken;
  }

  return await decryptWithKMS(cred.encryptedAccessToken!);
}
```
