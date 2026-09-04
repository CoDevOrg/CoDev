import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderAccountCard } from "./provider-account-card";
import type {
  CliSubscriptionRecord,
  ProviderConnectionRecord,
} from "@/lib/provider-connection-view";

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
    ...overrides,
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

  it("takes the authorization code Claude hands back", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "manual_code",
          authorizeUrl: "https://platform.claude.com/oauth/authorize?x=1",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

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

    fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
    fireEvent.change(
      await screen.findByLabelText("Claude authorization code"),
      { target: { value: "code#state" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Claude is connected.",
      );
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/auth/oauth/claude/complete",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the terminal commands as a fallback, not the first thing offered", () => {
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
      screen.getByRole("button", { name: "Connect Codex" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Connect from a terminal")).toBeInTheDocument();
    expect(screen.getByText("Use an API key instead")).toBeInTheDocument();
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
});
