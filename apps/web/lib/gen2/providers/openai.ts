import "server-only";

import type { Gen2ProviderReadiness } from "@codev/contracts";

import { getAgentModel } from "../../providers/ai-model";
import {
  claimHostedCodexExecution,
  HostedCodexSubscriptionError,
  releaseHostedCodexExecution,
  resolveHostedCodexSubscription,
  updateHostedCodexAuthCache,
} from "../../providers/hosted-codex-subscription-credentials";
import { ensureHostReady } from "../../runtime/orchestrator-health";
import {
  closeCodexExecInSandbox,
  pollCodexExecInSandbox,
  startCodexExecInSandbox,
} from "../../runtime/orchestrator-codex-exec";
import { OrchestratorError } from "../../runtime/orchestrator-request";
import { buildGen2Context } from "../chats-format";
import { gen2CodexSandboxForPolicy } from "../execution-policy";
import { DEFAULT_GEN2_AGENT_EXECUTION_POLICY } from "../execution-policy";
import { describeGen2RuntimeFailure } from "../instance";
import { getGen2ProviderDefinition } from "../provider-catalog";
import type {
  Gen2ProviderAdapter,
  Gen2ProviderPollResult,
  Gen2ProviderTurnInput,
} from "../provider-adapters";
import { getGen2ProviderStatus, resolveGen2Codex } from "../providers";

export function buildGen2CodexCommand(
  prompt: string,
  history: Gen2ProviderTurnInput["history"],
  executionPolicy: Gen2ProviderTurnInput["executionPolicy"] = DEFAULT_GEN2_AGENT_EXECUTION_POLICY,
) {
  return [
    "codex",
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    gen2CodexSandboxForPolicy(executionPolicy),
    "-c",
    'approval_policy="never"',
    "--model",
    getAgentModel("openai"),
    "--cd",
    ".",
    [
      "You are Codex on this workspace's Firecracker machine.",
      "The working directory is /workspace. Use the shell to inspect and change files there.",
      "Answer the user. If they ask for code changes, make them in the current directory.",
      "Do not inspect CODEX_HOME or authentication files.",
      "",
      buildGen2Context(prompt, history).prompt,
    ].join("\n"),
  ];
}

async function releaseOpenAiTurn(userId: string) {
  const hosted = await resolveHostedCodexSubscription({
    userId,
    includeBusy: true,
  });
  if (hosted?.credential.id) {
    await releaseHostedCodexExecution(hosted.credential.id);
  }
}

async function finishOpenAiTurn(userId: string, authCacheJson?: string) {
  const hosted = await resolveHostedCodexSubscription({
    userId,
    includeBusy: true,
  });
  if (!hosted?.credential.id) return;
  try {
    if (authCacheJson) {
      await updateHostedCodexAuthCache(hosted.credential.id, authCacheJson);
    }
  } finally {
    await releaseHostedCodexExecution(hosted.credential.id);
  }
}

export const openAiGen2ProviderAdapter: Gen2ProviderAdapter = {
  id: "openai",

  async getReadiness(userId): Promise<Gen2ProviderReadiness> {
    const status = await getGen2ProviderStatus(userId);
    return {
      ...getGen2ProviderDefinition("openai"),
      ready: status.connected,
    };
  },

  async start(input) {
    const credential = await resolveGen2Codex(input.userId);
    let claimed = false;
    if (credential.credentialId) {
      try {
        await claimHostedCodexExecution(credential.credentialId);
        claimed = true;
      } catch (error) {
        if (
          !(error instanceof HostedCodexSubscriptionError) ||
          error.code !== "hosted_codex_busy"
        ) {
          throw error;
        }
      }
    }

    const execInput = {
      command: buildGen2CodexCommand(
        input.prompt,
        input.history,
        input.executionPolicy,
      ),
      codexAuthCacheJson: credential.authCacheJson,
      idempotencyKey: input.idempotencyKey,
    };
    try {
      try {
        return {
          sessionId: await startCodexExecInSandbox(
            input.workspaceId,
            execInput,
          ),
        };
      } catch (error) {
        if (
          !/Firecracker host could not be reached/.test(
            describeGen2RuntimeFailure(error),
          )
        ) {
          throw error;
        }
        await ensureHostReady();
        return {
          sessionId: await startCodexExecInSandbox(
            input.workspaceId,
            execInput,
          ),
        };
      }
    } catch (error) {
      if (claimed && credential.credentialId) {
        await releaseHostedCodexExecution(credential.credentialId);
      }
      throw error;
    }
  },

  async poll(input): Promise<Gen2ProviderPollResult> {
    const result = await pollCodexExecInSandbox(
      input.workspaceId,
      input.sessionId,
      input.after,
    );
    if (result.exited) {
      await finishOpenAiTurn(input.turnOwnerId, result.codexAuthCacheJson);
    }
    return {
      chunks: result.chunks,
      nextSequence: result.nextSequence,
      exited: result.exited,
      exitCode: result.exitCode,
    };
  },

  async cancel(input) {
    try {
      await closeCodexExecInSandbox(input.workspaceId, input.sessionId);
    } catch (error) {
      if (!(error instanceof OrchestratorError && error.status === 404)) {
        throw error;
      }
    } finally {
      await releaseOpenAiTurn(input.turnOwnerId);
    }
  },

  release: releaseOpenAiTurn,
};
