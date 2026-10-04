import { z } from "zod";

import { organizationRoleSchema } from "@codev/contracts";

const uuid = z.string().uuid();

export function parseOrganizationMemberRole(formData: FormData) {
  return z
    .object({
      organizationId: uuid,
      userId: uuid,
      role: organizationRoleSchema,
    })
    .parse({
      organizationId: formData.get("organizationId"),
      userId: formData.get("userId"),
      role: formData.get("role"),
    });
}

export function parseAccountSubscription(formData: FormData) {
  return z
    .object({ userId: uuid, action: z.enum(["grant", "revoke"]) })
    .parse({ userId: formData.get("userId"), action: formData.get("action") });
}

export function parseApplicationAdmin(formData: FormData) {
  return z
    .object({ userId: uuid, isAdmin: z.enum(["true", "false"]) })
    .transform((value) => ({ ...value, isAdmin: value.isAdmin === "true" }))
    .parse({
      userId: formData.get("userId"),
      isAdmin: formData.get("isAdmin"),
    });
}
