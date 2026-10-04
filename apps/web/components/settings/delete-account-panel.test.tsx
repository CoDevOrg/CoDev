import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DeleteAccountPanel } from "./delete-account-panel";
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("account deletion confirmation", () => {
  it("requires an emailed code and typed confirmation, and keeps failures visible", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ sent: true }))
      .mockResolvedValueOnce(
        Response.json({ error: "Stop running agents first." }, { status: 409 }),
      );
    vi.stubGlobal("fetch", request);
    render(<DeleteAccountPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(request).not.toHaveBeenCalled();
    expect(
      screen.getByText(/shared chats you own are removed/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Send verification email" }),
    );
    await screen.findByText(/Verification email sent/);
    const remove = screen.getByRole("button", {
      name: "Permanently delete account",
    });
    expect(remove).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email verification code"), {
      target: { value: "code-from-email" },
    });
    expect(remove).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Stop running agents first.",
      ),
    );
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({
        token: "code-from-email",
        confirmation: "DELETE",
      }),
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
