import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestAccessForm } from "./request-access-form";

describe("RequestAccessForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks only for email and an optional use case", () => {
    render(<RequestAccessForm />);

    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(
      screen.getByLabelText(/What will you use CoDev for?/),
    ).not.toBeRequired();
    expect(screen.queryByLabelText(/Name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in/i)).not.toBeInTheDocument();
  });

  it("submits the email and optional use case", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "request-1" }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<RequestAccessForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "builder@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/What will you use CoDev for?/), {
      target: { value: "A side project with friends" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      email: "builder@example.com",
      building: "A side project with friends",
    });
    expect(await screen.findByText("You're on the list.")).toBeInTheDocument();
  });
});
