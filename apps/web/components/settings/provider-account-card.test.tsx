import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderAccountCard } from "./provider-account-card";
import type {
  CliSubscriptionRecord,
  ProviderConnectionRecord,
} from "@/lib/providers/provider-connection-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function subscription(
  overrides: Partial<CliSubscriptionRecord> = {},
): CliSubscriptionRecord {
  return {
    provider: "codex",
    label: "Codex",
    status: "not_connected",
    connectMode: "device_code",
    command: "codev codex-auth",
    provenance: null,
    allowInSharedWorkspaces: true,
    ...overrides,
  };
}

function connection(
  overrides: Partial<ProviderConnectionRecord> = {},
): ProviderConnectionRecord {
  return {
    provider: "openai",
    label: "OpenAI",
    status: "not_connected",
    credentialType: null,
    lastFour: null,
    suppliedBy: null,
    scope: "personal",
    provenance: null,
    allowInSharedWorkspaces: true,
    ...overrides,
  };
}

const NO_CLI_TOKEN = {
  status: "not_connected" as const,
  lastFour: null,
  allowInSharedWorkspaces: true,
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("ProviderAccountCard", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("offers Claude only an API key and the CLI, no browser OAuth button", () => {
    render(
      <ProviderAccountCard
        connection={connection({ provider: "anthropic", label: "Anthropic" })}
        label="Claude"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "claude",
          label: "Claude Code",
          connectMode: "manual_code",
          command: "codev claude-auth",
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Connect Claude" })).toBeNull();
    expect(screen.getByText("Connect from a terminal")).toBeInTheDocument();
    expect(screen.getByText("Use an API key instead")).toBeInTheDocument();
  });

  it("connects Claude in-app: start, paste the code, poll to connected", async () => {
    let submitted = false;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "sess-1",
          status: "awaiting_code",
          authorizeUrl: "https://platform.claude.com/oauth/authorize?x=1",
          failureReason: null,
        }),
      )
      .mockImplementation(async (url: string) => {
        if (url.endsWith("/code")) {
          submitted = true;
          return jsonResponse({ id: "sess-1", status: "exchanging" });
        }
        return jsonResponse({
          id: "sess-1",
          status: submitted ? "connected" : "awaiting_code",
          authorizeUrl: null,
          failureReason: null,
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProviderAccountCard
        connection={connection({ provider: "anthropic", label: "Anthropic" })}
        hostedClaudeConnect
        label="Claude"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "claude",
          label: "Claude Code",
          connectMode: "manual_code",
          command: "codev claude-auth",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));

    const input = await screen.findByPlaceholderText("Paste code");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/personal/claude-connection/session",
    );
    expect(window.open).toHaveBeenCalledWith(
      "https://platform.claude.com/oauth/authorize?x=1",
      "_blank",
      "noopener,noreferrer",
    );

    fireEvent.change(input, { target: { value: "code123#state" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(
      () => {
        expect(screen.getByRole("status")).toHaveTextContent(
          "Claude is connected.",
        );
      },
      { timeout: 4000 },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/personal/claude-connection/session/sess-1/code",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/personal/claude-connection/session/sess-1",
      expect.anything(),
    );
  });

  it("releases the hosted Claude runner when canceled", async () => {
    // The flow polls the session while awaiting the code, so keep returning
    // `awaiting_code` — the Cancel button must stay available until clicked.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "sess-cancel",
        status: "awaiting_code",
        authorizeUrl: "https://platform.claude.com/oauth/authorize?x=1",
        failureReason: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProviderAccountCard
        connection={connection({ provider: "anthropic", label: "Anthropic" })}
        hostedClaudeConnect
        label="Claude"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "claude",
          label: "Claude Code",
          connectMode: "manual_code",
          command: "codev claude-auth",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
    await screen.findByPlaceholderText("Paste code");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Connect Claude" }),
      ).toBeVisible();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/personal/claude-connection/session/sess-cancel",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("connects ChatGPT in-app via device code: start, show code, poll to connected", async () => {
    let polls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/auth/oauth/codex/session") {
        return jsonResponse({
          mode: "device_code",
          verificationUrl: "https://auth.openai.com/codex/device",
          userCode: "WDJB-MJHT",
          deviceAuthId: "dev-1",
          intervalSeconds: 1,
        });
      }
      // First poll stays pending so the user code is on screen to assert;
      // the next poll reports the linked account.
      polls += 1;
      return jsonResponse({ status: polls > 1 ? "connected" : "pending" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProviderAccountCard
        connection={connection({ provider: "openai", label: "OpenAI" })}
        hostedOpenAIConnect
        label="Codex"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "codex",
          label: "Codex",
          connectMode: "device_code",
          command: "codev codex-auth",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT" }));

    expect(await screen.findByText("WDJB-MJHT")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/oauth/codex/session");
    expect(window.open).toHaveBeenCalledWith(
      "https://auth.openai.com/codex/device",
      "_blank",
      "noopener,noreferrer",
    );

    await waitFor(
      () => {
        expect(screen.getByRole("status")).toHaveTextContent(
          "Codex is connected.",
        );
      },
      { timeout: 4000 },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/oauth/codex/poll",
      expect.objectContaining({ method: "POST" }),
    );
    const pollBody = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    );
    expect(pollBody).toMatchObject({
      deviceAuthId: "dev-1",
      userCode: "WDJB-MJHT",
    });
  });

  it("shows no ChatGPT device-code button unless hostedOpenAIConnect is set", () => {
    render(
      <ProviderAccountCard
        connection={connection({ provider: "openai", label: "OpenAI" })}
        label="Codex"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "codex",
          label: "Codex",
          connectMode: "device_code",
          command: "codev codex-auth",
        })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Connect ChatGPT" }),
    ).toBeNull();
  });

  it("does not overlap long-running Claude status polls", async () => {
    let resolvePoll!: (response: Response) => void;
    const pendingPoll = new Promise<Response>((resolve) => {
      resolvePoll = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "sess-poll",
          status: "awaiting_code",
          authorizeUrl: "https://platform.claude.com/oauth/authorize?x=1",
          failureReason: null,
        }),
      )
      // The status poll fires as soon as the session opens, before the member
      // could have pasted anything, so it has to keep reporting
      // `awaiting_code`: `exchanging` means authorization already finished
      // elsewhere, which correctly tears down the paste-code form this test
      // needs to submit through.
      .mockResolvedValueOnce(
        jsonResponse({
          id: "sess-poll",
          status: "awaiting_code",
          authorizeUrl: "https://platform.claude.com/oauth/authorize?x=1",
          failureReason: null,
        }),
      )
      .mockReturnValue(pendingPoll);
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(
      <ProviderAccountCard
        connection={connection({ provider: "anthropic", label: "Anthropic" })}
        hostedClaudeConnect
        label="Claude"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "claude",
          label: "Claude Code",
          connectMode: "manual_code",
          command: "codev claude-auth",
        })}
      />,
    );

    // Fake timers go in before the session opens. Installing them afterwards
    // leaves the poll's own setTimeout on the real clock, so it fires for
    // real partway through advanceTimersByTimeAsync below and issues a fetch
    // this test never mocked.
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
    const input = await vi.waitFor(() =>
      screen.getByPlaceholderText("Paste code"),
    );
    fireEvent.change(input, { target: { value: "code123#state" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolvePoll(
        jsonResponse({
          id: "sess-poll",
          status: "exchanging",
          authorizeUrl: null,
          failureReason: null,
        }),
      );
      await Promise.resolve();
    });
    unmount();
  });

  it("offers Codex only an API key and the CLI, no browser OAuth button", () => {
    render(
      <ProviderAccountCard
        connection={connection({ provider: "openai", label: "OpenAI" })}
        label="Codex"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "codex",
          label: "Codex",
          connectMode: "device_code",
          command: "codev codex-auth",
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Connect Codex" })).toBeNull();
    expect(screen.getByText("Connect from a terminal")).toBeInTheDocument();
    expect(screen.getByText("Use an API key instead")).toBeInTheDocument();
  });

  it("still offers Codex a Disconnect button once connected via the CLI", () => {
    render(
      <ProviderAccountCard
        connection={connection({ provider: "openai", label: "OpenAI" })}
        label="Codex"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "codex",
          label: "Codex",
          status: "connected",
          connectMode: "device_code",
          command: "codev codex-auth",
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("confirms before disconnecting and says what stops working", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ProviderAccountCard
        connection={connection({ provider: "openai", label: "OpenAI" })}
        label="Codex"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "codex",
          label: "Codex",
          status: "connected",
          command: "codev codex-auth",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Agents stop running on this Codex login",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Codex" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/personal/subscriptions?provider=codex",
        { method: "DELETE" },
      ),
    );
  });

  it("summarises how a connected account signs in", () => {
    render(
      <ProviderAccountCard
        connection={connection({ provider: "openai", label: "OpenAI" })}
        label="Codex"
        logo={null}
        runsIn={[]}
        subscription={subscription({
          provider: "codex",
          label: "Codex",
          status: "connected",
          command: "codev codex-auth",
        })}
      />,
    );
    expect(
      screen.getByText("Signed in with a subscription"),
    ).toBeInTheDocument();
    expect(screen.getByText("Manage connection")).toBeInTheDocument();
  });

  describe("where a connection runs", () => {
    it("names the surfaces the registry reports, not a section it sits in", () => {
      render(
        <ProviderAccountCard
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "openai", label: "OpenAI" })}
          label="Codex"
          logo={null}
          runsIn={["gen2", "rooms"]}
          subscription={subscription({
            provider: "codex",
            label: "Codex",
            status: "connected",
            provenance: "cli",
          })}
        />,
      );

      // Named the way the sidebar names them, so "where does this work" is
      // answered in the member's own vocabulary.
      expect(screen.getByText("Workspaces")).toBeInTheDocument();
      expect(screen.getByText("Rooms")).toBeInTheDocument();
    });

    it("states the surfaces in text, not by the colour of a dot", () => {
      render(
        <ProviderAccountCard
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          label="Claude"
          logo={null}
          runsIn={["rooms"]}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            status: "connected",
            provenance: "browser",
          })}
        />,
      );

      // A member who cannot tell the dot's colour apart still reads it.
      expect(screen.getByText("Runs in Rooms")).toBeInTheDocument();
    });

    it("distinguishes connected-but-unrunnable from not connected", () => {
      const { unmount } = render(
        <ProviderAccountCard
          claudeCliToken={{
            status: "connected",
            lastFour: "wxyz",
            allowInSharedWorkspaces: true,
          }}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          label="Claude"
          logo={null}
          runsIn={[]}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            status: "not_connected",
          })}
        />,
      );
      expect(
        screen.getByText("Connected, but nothing here can run it yet"),
      ).toBeInTheDocument();
      unmount();

      render(
        <ProviderAccountCard
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({
            provider: "anthropic",
            label: "Anthropic",
            status: "not_connected",
          })}
          label="Claude"
          logo={null}
          runsIn={[]}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            status: "not_connected",
          })}
        />,
      );
      expect(screen.getByText("Not connected")).toBeInTheDocument();
    });

    it("offers every connect method on one card", () => {
      // The two sections this replaced each hid half of these.
      render(
        <ProviderAccountCard
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "openai", label: "OpenAI" })}
          hostedOpenAIConnect
          label="Codex"
          logo={null}
          runsIn={[]}
          subscription={subscription({
            provider: "codex",
            label: "Codex",
            connectMode: "device_code",
            command: "codev codex-auth",
            status: "not_connected",
          })}
        />,
      );

      expect(
        screen.getByRole("button", { name: /Connect ChatGPT/ }),
      ).toBeInTheDocument();
      expect(screen.getByText("Connect from a terminal")).toBeInTheDocument();
      expect(screen.getByText("Use an API key instead")).toBeInTheDocument();
    });

    it("asks about shared workspaces only for a login a workspace can run", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ connections: [] }));
      vi.stubGlobal("fetch", fetchMock);

      const { unmount } = render(
        <ProviderAccountCard
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          label="Claude"
          logo={null}
          runsIn={["rooms"]}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            status: "connected",
            provenance: "browser",
          })}
        />,
      );
      // Rooms run in the member's own session, so there is nothing to ask.
      expect(
        screen.queryByRole("switch", { name: "Allow in shared workspaces" }),
      ).toBeNull();
      unmount();

      render(
        <ProviderAccountCard
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "openai", label: "OpenAI" })}
          label="Codex"
          logo={null}
          runsIn={["gen2"]}
          subscription={subscription({
            provider: "codex",
            label: "Codex",
            status: "connected",
            provenance: "cli",
            command: "codev codex-auth",
          })}
        />,
      );
      const toggle = screen.getByRole("switch", {
        name: "Allow in shared workspaces",
      });
      fireEvent.click(toggle);
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/personal/connections",
          expect.objectContaining({ method: "PATCH" }),
        );
      });
    });

    it("shows and revokes Claude's CLI login beside the command that made it", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <ProviderAccountCard
          claudeCliToken={{
            status: "connected",
            lastFour: "wxyz",
            allowInSharedWorkspaces: true,
          }}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          label="Claude"
          logo={null}
          runsIn={["gen2"]}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            command: "codev claude-auth",
            status: "not_connected",
          })}
        />,
      );

      expect(screen.getByText(/ending wxyz/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
      fireEvent.click(screen.getByRole("button", { name: "Revoke login" }));
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/personal/connections?provider=anthropic&kind=claude_cli_token",
          { method: "DELETE" },
        );
      });
    });
  });
});
