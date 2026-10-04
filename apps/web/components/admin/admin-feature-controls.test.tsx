// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateOrganizationPlan: vi.fn(),
  updateOrganizationFeatureOverride: vi.fn(),
  updateUserFeatureOverride: vi.fn(),
}));

vi.mock("@/app/admin/actions", () => mocks);

import { AdminFeatureControls } from "./admin-feature-controls";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";

const data: AdminFeatureAccessData = {
  organizations: [
    {
      id: "org-one",
      name: "First organization",
      slug: "first",
      planId: "free",
    },
    {
      id: "org-two",
      name: "Second organization",
      slug: "second",
      planId: "free",
    },
  ],
  plans: [
    { id: "free", name: "Free" },
    { id: "pro", name: "Individual" },
  ],
  members: [
    {
      organizationId: "org-one",
      userId: "user-one",
      login: "ada",
      name: "Ada",
      role: "owner",
    },
    {
      organizationId: "org-two",
      userId: "user-two",
      login: "grace",
      name: "Grace",
      role: "owner",
    },
  ],
  organizationOverrides: [
    {
      organizationId: "org-one",
      feature: "hosted_codex_subscription",
      enabled: false,
      expiresAt: null,
    },
  ],
  userOverrides: [],
  auditEvents: [],
};

function submittedData(action: ReturnType<typeof vi.fn>) {
  return action.mock.calls[0]?.[0] as FormData;
}

beforeEach(() => {
  mocks.updateOrganizationPlan.mockResolvedValue({
    ok: true,
    message: "Organization plan updated.",
  });
  mocks.updateOrganizationFeatureOverride.mockResolvedValue({
    ok: true,
    message: "Organization feature access updated.",
  });
  mocks.updateUserFeatureOverride.mockResolvedValue({
    ok: true,
    message: "User feature access updated.",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin feature controls", () => {
  it("applies the selected organization plan", async () => {
    const { container } = render(<AdminFeatureControls data={data} />);
    const planForm = container.querySelectorAll("form")[0]!;

    fireEvent.change(within(planForm).getByLabelText("Plan to apply"), {
      target: { value: "pro" },
    });
    fireEvent.submit(planForm);

    await waitFor(() =>
      expect(mocks.updateOrganizationPlan).toHaveBeenCalledOnce(),
    );
    expect(
      submittedData(mocks.updateOrganizationPlan).get("organizationId"),
    ).toBe("org-one");
    expect(submittedData(mocks.updateOrganizationPlan).get("planId")).toBe(
      "pro",
    );
    expect(screen.getByText("Organization plan updated.")).toBeTruthy();
  });

  it("applies an organization feature override", async () => {
    const { container } = render(<AdminFeatureControls data={data} />);
    const form = container.querySelectorAll("form")[1]!;

    fireEvent.change(within(form).getByLabelText("Access override"), {
      target: { value: "enabled" },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(mocks.updateOrganizationFeatureOverride).toHaveBeenCalledOnce(),
    );
    const values = submittedData(mocks.updateOrganizationFeatureOverride);
    expect(values.get("organizationId")).toBe("org-one");
    expect(values.get("feature")).toBe("hosted_codex_subscription");
    expect(values.get("state")).toBe("enabled");
    expect(
      screen.getByText("Organization feature access updated."),
    ).toBeTruthy();
  });

  it("changes the selected member when the organization changes", async () => {
    const { container } = render(<AdminFeatureControls data={data} />);
    const form = container.querySelectorAll("form")[2]!;

    fireEvent.change(within(form).getByLabelText("Organization"), {
      target: { value: "org-two" },
    });
    const memberSelect = within(form).getByLabelText("Member");
    if (!(memberSelect instanceof HTMLSelectElement)) {
      throw new Error("Member field is not a select control.");
    }
    expect(memberSelect.value).toBe("user-two");
    fireEvent.change(within(form).getByLabelText("Access override"), {
      target: { value: "disabled" },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(mocks.updateUserFeatureOverride).toHaveBeenCalledOnce(),
    );
    const values = submittedData(mocks.updateUserFeatureOverride);
    expect(values.get("organizationId")).toBe("org-two");
    expect(values.get("userId")).toBe("user-two");
    expect(values.get("state")).toBe("disabled");
  });

  it("removes a current override and returns it to inherited access", async () => {
    render(<AdminFeatureControls data={data} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove organization override for First organization",
      }),
    );

    await waitFor(() =>
      expect(mocks.updateOrganizationFeatureOverride).toHaveBeenCalledOnce(),
    );
    const values = submittedData(mocks.updateOrganizationFeatureOverride);
    expect(values.get("organizationId")).toBe("org-one");
    expect(values.get("feature")).toBe("hosted_codex_subscription");
    expect(values.get("state")).toBe("inherit");
    expect(
      screen.getByText("Organization feature access updated."),
    ).toBeTruthy();
  });

  it("removes a member override and returns it to organization policy", async () => {
    render(
      <AdminFeatureControls
        data={{
          ...data,
          userOverrides: [
            {
              organizationId: "org-one",
              userId: "user-one",
              feature: "hosted_codex_subscription",
              enabled: true,
              expiresAt: null,
            },
          ],
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove member override for @ada",
      }),
    );

    await waitFor(() =>
      expect(mocks.updateUserFeatureOverride).toHaveBeenCalledOnce(),
    );
    const values = submittedData(mocks.updateUserFeatureOverride);
    expect(values.get("organizationId")).toBe("org-one");
    expect(values.get("userId")).toBe("user-one");
    expect(values.get("feature")).toBe("hosted_codex_subscription");
    expect(values.get("state")).toBe("inherit");
    expect(screen.getByText("User feature access updated.")).toBeTruthy();
  });
});
