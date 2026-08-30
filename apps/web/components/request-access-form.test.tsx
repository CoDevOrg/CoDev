import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestAccessForm } from "./request-access-form";

describe("RequestAccessForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires only email; name and use case are optional", () => {
    render(<RequestAccessForm />);

    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText(/^Name/)).not.toBeRequired();

    const choices = screen.getByRole("group", {
      name: /What will you use CoDev for\?/,
    });
    expect(choices).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeRequired();
    }
    expect(screen.queryByText(/Sign in/i)).not.toBeInTheDocument();
  });

  it("offers six use-case choices including Other", () => {
    render(<RequestAccessForm />);

    expect(
      screen.getAllByRole("radio").map((radio) => radio.getAttribute("value")),
    ).toEqual([
      "A side project",
      "A startup or product",
      "Client or freelance work",
      "Learning or school",
      "Hackathon or game jam",
      "Other",
    ]);
  });

  it("submits the email, optional name, and the chosen use case", async () => {
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
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "A side project" }));
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      email: "builder@example.com",
      name: "Ada",
      building: "A side project",
    });
    expect(await screen.findByText("You're on the list.")).toBeInTheDocument();
  });
});
