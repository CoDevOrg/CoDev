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
    provider: "cursor",
    label: "Cursor",
    status: "not_connected",
    connectMode: "cursor_deeplink",
    command: null,
    provenance: null,
    enabledForRooms: false,
    enabledForWorkspace: false,
    ...overrides,
  };
}

function connection(
  overrides: Partial<ProviderConnectionRecord> = {},
): ProviderConnectionRecord {
  return {
    provider: "cursor",
    label: "Cursor",
    status: "not_connected",
    credentialType: null,
    lastFour: null,
    suppliedBy: null,
    scope: "personal",
    provenance: null,
    enabledForRooms: false,
    enabledForWorkspace: false,
    ...overrides,
  };
}

const NO_CLI_TOKEN = {
  status: "not_connected",
  lastFour: null,
  enabledForRooms: false,
  enabledForWorkspace: false,
} as const;

function capability(input: { rooms?: boolean; workspace?: boolean }) {
  return {
    rooms: { ready: input.rooms ?? false, via: [] },
    workspace: { ready: input.workspace ?? false, via: [] },
  };
}

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

  it("signs a member in through Cursor's browser login without an API key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "cursor_deeplink",
          loginUrl: "https://cursor.com/loginDeepControl?challenge=abc",
        }),
      )
      .mockResolvedValue(jsonResponse({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProviderAccountCard
        connection={connection()}
        label="Cursor"
        logo={null}
        subscription={subscription()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Cursor" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Cursor is connected.",
      );
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/oauth/cursor/session");
    expect(window.open).toHaveBeenCalledWith(
      "https://cursor.com/loginDeepControl?challenge=abc",
      "_blank",
      "noopener,noreferrer",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/oauth/cursor/poll");
    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("exchanges a Cursor API key through the /complete route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProviderAccountCard
        connection={connection()}
        label="Cursor"
        logo={null}
        subscription={subscription()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("key_…"), {
      target: { value: "key_live_123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Cursor is connected.",
      );
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/auth/oauth/cursor/complete",
    );
    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string),
    ).toMatchObject({ apiKey: "key_live_123", scopeType: "USER" });
  });

  it("offers Claude only an API key and the CLI, no browser OAuth button", () => {
    render(
      <ProviderAccountCard
        connection={connection({ provider: "anthropic", label: "Anthropic" })}
        label="Claude"
        logo={null}
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

  it("offers no terminal fallback for a provider without a CoDev CLI command", () => {
    render(
      <ProviderAccountCard
        connection={connection()}
        label="Cursor"
        logo={null}
        subscription={subscription()}
      />,
    );

    expect(screen.queryByText("Connect from a terminal")).toBeNull();
  });

  it("signs out through the subscription endpoint, leaving the API key alone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProviderAccountCard
        connection={connection()}
        label="Cursor"
        logo={null}
        subscription={subscription({ status: "connected" })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/personal/subscriptions?provider=cursor",
      { method: "DELETE" },
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Connect Cursor" }),
      ).toBeInTheDocument();
    });
  });

  describe("surface sections", () => {
    it("the workspace section offers no browser sign-in, only an API key and the CLI", () => {
      render(
        <ProviderAccountCard
          capability={capability({})}
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          hostedClaudeConnect
          label="Claude"
          logo={null}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            connectMode: "manual_code",
            command: "codev claude-auth",
          })}
          surface="workspace"
        />,
      );

      expect(
        screen.queryByRole("button", { name: "Connect Claude" }),
      ).toBeNull();
      expect(screen.getByText("Use an API key instead")).toBeInTheDocument();
      expect(screen.getByText("Connect from a terminal")).toBeInTheDocument();
      expect(
        screen.getByText("Connect with an API key or from your terminal below"),
      ).toBeInTheDocument();
    });

    it("the rooms section offers the browser sign-in and the CLI, but no API key", () => {
      render(
        <ProviderAccountCard
          capability={capability({})}
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          hostedClaudeConnect
          label="Claude"
          logo={null}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            connectMode: "manual_code",
            command: "codev claude-auth",
          })}
          surface="rooms"
        />,
      );

      expect(
        screen.getByRole("button", { name: "Connect Claude" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Use an API key instead")).toBeNull();
      expect(screen.getByText("Connect from a terminal")).toBeInTheDocument();
    });

    /**
     * Claude's browser runtime lives in the member's own sandbox and never
     * reaches the shared workspace host, so there is nothing to enable — the
     * card says so instead of offering a toggle that `providerSurfaceCapability`
     * would refuse to honour.
     */
    it("explains that a Claude browser sign-in cannot be enabled for workspaces", () => {
      render(
        <ProviderAccountCard
          capability={capability({ rooms: true })}
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          label="Claude"
          logo={null}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            status: "connected",
            connectMode: "manual_code",
            command: "codev claude-auth",
            provenance: "browser",
            enabledForRooms: true,
            enabledForWorkspace: false,
          })}
          surface="rooms"
        />,
      );

      expect(screen.queryByRole("switch")).toBeNull();
      expect(
        screen.getByText(/Browser sign-ins stay in chat rooms/),
      ).toBeInTheDocument();
    });

    /**
     * Codex is the exception, and the card must track it: a browser OAuth
     * login and a local CLI login materialize the same auth cache, so
     * `providerSurfaceCapability` accepts either for a workspace
     * (`provenance === "cli" || provider === "openai"`). Offering the toggle
     * here is only correct for as long as that stays true.
     */
    it("lets a Codex browser sign-in be enabled for workspaces", () => {
      render(
        <ProviderAccountCard
          capability={capability({ rooms: true })}
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "openai", label: "OpenAI" })}
          label="Codex"
          logo={null}
          subscription={subscription({
            provider: "codex",
            label: "Codex",
            status: "connected",
            connectMode: "device_code",
            command: "codev codex-auth",
            provenance: "browser",
            enabledForRooms: true,
            enabledForWorkspace: false,
          })}
          surface="rooms"
        />,
      );

      expect(
        screen.getByRole("switch", { name: "Also use in coding workspaces" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Browser sign-ins stay in chat rooms/),
      ).toBeNull();
    });

    it("lets a terminal login be enabled for the other surface", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ connections: [] }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <ProviderAccountCard
          capability={capability({ rooms: true, workspace: true })}
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "openai", label: "OpenAI" })}
          label="Codex"
          logo={null}
          subscription={subscription({
            provider: "codex",
            label: "Codex",
            status: "connected",
            connectMode: "device_code",
            command: "codev codex-auth",
            provenance: "cli",
            enabledForRooms: true,
            enabledForWorkspace: false,
          })}
          surface="rooms"
        />,
      );

      const toggle = screen.getByRole("switch", {
        name: "Also use in coding workspaces",
      });
      expect(toggle).toHaveAttribute("aria-checked", "false");
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/personal/connections",
          expect.objectContaining({ method: "PATCH" }),
        );
      });
      expect(
        JSON.parse(
          (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
        ),
      ).toEqual({
        provider: "openai",
        kind: "subscription",
        surface: "workspace",
        enabled: true,
      });
    });

    it("shows and revokes Claude's CLI login in the workspace section", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <ProviderAccountCard
          capability={capability({ workspace: true })}
          claudeCliToken={{
            status: "connected",
            lastFour: "wxyz",
            enabledForRooms: false,
            enabledForWorkspace: true,
          }}
          connection={connection({ provider: "anthropic", label: "Anthropic" })}
          label="Claude"
          logo={null}
          subscription={subscription({
            provider: "claude",
            label: "Claude Code",
            connectMode: "manual_code",
            command: "codev claude-auth",
          })}
          surface="workspace"
        />,
      );

      expect(
        screen.getByText("Ready for coding workspaces"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Connected via codev claude-auth · ending wxyz/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Revoke CLI login" }));
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/personal/connections?provider=anthropic&kind=claude_cli_token",
          { method: "DELETE" },
        );
      });
    });

    it("sends the originating section with a pasted key", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ connections: [] }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <ProviderAccountCard
          capability={capability({})}
          claudeCliToken={NO_CLI_TOKEN}
          connection={connection({ provider: "openai", label: "OpenAI" })}
          label="Codex"
          logo={null}
          subscription={subscription({
            provider: "codex",
            label: "Codex",
            connectMode: "device_code",
            command: "codev codex-auth",
          })}
          surface="workspace"
        />,
      );

      fireEvent.change(screen.getByPlaceholderText("Paste API key"), {
        target: { value: "sk-openai-a-long-enough-key" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save key" }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      expect(
        JSON.parse(
          (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
        ),
      ).toMatchObject({ provider: "openai", surface: "workspace" });
    });
  });
});
