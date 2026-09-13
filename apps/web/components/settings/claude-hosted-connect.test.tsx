import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ClaudeHostedConnect } from "./claude-hosted-connect";

const BASE = "/api/personal/claude-connection/session";
const session = {
  id: "session-1",
  status: "awaiting_code",
  authorizeUrl: "https://claude.ai/oauth/authorize?test=true",
  failureReason: null,
};
const response = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("open", vi.fn());
  fetchMock = vi.fn().mockResolvedValue(response(session));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
  });
}

it("detects browser completion without a code submission", async () => {
  const onConnected = vi.fn();
  render(<ClaudeHostedConnect connected={false} onConnected={onConnected} />);
  await start();
  expect(fetchMock).toHaveBeenCalledWith(
    `${BASE}/session-1`,
    expect.anything(),
  );
  fetchMock.mockResolvedValue(response({ ...session, status: "connected" }));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(onConnected).toHaveBeenCalledOnce();
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith("/code")),
  ).toBe(false);
  const count = fetchMock.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(fetchMock).toHaveBeenCalledTimes(count);
});

it("keeps manual code submission available while polling", async () => {
  const onConnected = vi.fn();
  render(<ClaudeHostedConnect connected={false} onConnected={onConnected} />);
  await start();
  fetchMock.mockResolvedValueOnce(
    response({ ...session, status: "exchanging" }),
  );
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Authorization code"), {
      target: { value: "code#state" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  });
  expect(fetchMock).toHaveBeenCalledWith(
    `${BASE}/session-1/code`,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ code: "code#state" }),
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Linking");
  fetchMock.mockResolvedValue(response({ ...session, status: "connected" }));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(onConnected).toHaveBeenCalledOnce();
});

it("does not overlap slow polls and ignores a response after cancellation", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockResolvedValueOnce(response(session)).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const onConnected = vi.fn();
  render(<ClaudeHostedConnect connected={false} onConnected={onConnected} />);
  await start();
  await act(() => vi.advanceTimersByTimeAsync(12000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {
    finish(response({ ...session, status: "connected" }));
  });
  expect(onConnected).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Connect Claude" }),
  ).toBeInTheDocument();
});

it("uses the server session expiry instead of timing out after three minutes", async () => {
  render(<ClaudeHostedConnect connected={false} onConnected={vi.fn()} />);
  await start();
  await act(() => vi.advanceTimersByTimeAsync(190000));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fetchMock.mockResolvedValue(
    response({
      ...session,
      status: "failed",
      failureReason: "The connection attempt timed out.",
    }),
  );
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByRole("alert")).toHaveTextContent("timed out");
});

it("shows a retryable startup network failure", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  render(<ClaudeHostedConnect connected={false} onConnected={vi.fn()} />);
  await start();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not reach CoDev");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("aborts polling when unmounted", async () => {
  const { unmount } = render(
    <ClaudeHostedConnect connected={false} onConnected={vi.fn()} />,
  );
  await start();
  const signal = fetchMock.mock.calls[1]?.[1].signal as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
  // Unmount frees the hosted session on the server, then never polls again.
  expect(fetchMock).toHaveBeenCalledWith(
    `${BASE}/session-1`,
    expect.objectContaining({ method: "DELETE" }),
  );
  const settled = fetchMock.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(fetchMock).toHaveBeenCalledTimes(settled);
});
