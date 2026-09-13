import { z } from "zod";

import { featureKeySchema, planIdSchema } from "@codev/contracts";

const uuid = z.string().uuid();
const overrideStateSchema = z.enum(["inherit", "enabled", "disabled"]);

function parseExpiry(
  value: FormDataEntryValue | null,
  timezoneOffsetValue: FormDataEntryValue | null,
): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timezoneOffset = z.coerce
    .number()
    .int()
    .min(-840)
    .max(840)
    .parse(timezoneOffsetValue ?? 0);
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const expiresAt = local
    ? new Date(
        Date.UTC(
          Number(local[1]),
          Number(local[2]) - 1,
          Number(local[3]),
          Number(local[4]),
          Number(local[5]),
        ) +
          timezoneOffset * 60_000,
      )
    : new Date(value);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Enter a valid expiry date and time.");
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error("Expiry must be in the future.");
  }
  return expiresAt;
}

export function parsePlanAssignment(formData: FormData) {
  return z.object({ organizationId: uuid, planId: planIdSchema }).parse({
    organizationId: formData.get("organizationId"),
    planId: formData.get("planId"),
  });
}

export function parseOrganizationOverride(formData: FormData) {
  const values = z
    .object({
      organizationId: uuid,
      feature: featureKeySchema,
      state: overrideStateSchema,
    })
    .parse({
      organizationId: formData.get("organizationId"),
      feature: formData.get("feature"),
      state: formData.get("state"),
    });
  return {
    ...values,
    expiresAt:
      values.state === "inherit"
        ? null
        : parseExpiry(
            formData.get("expiresAt"),
            formData.get("timezoneOffset"),
          ),
  };
}

export function parseUserOverride(formData: FormData) {
  const values = z
    .object({
      organizationId: uuid,
      userId: uuid,
      feature: featureKeySchema,
      state: overrideStateSchema,
    })
    .parse({
      organizationId: formData.get("organizationId"),
      userId: formData.get("userId"),
      feature: formData.get("feature"),
      state: formData.get("state"),
    });
  return {
    ...values,
    expiresAt:
      values.state === "inherit"
        ? null
        : parseExpiry(
            formData.get("expiresAt"),
            formData.get("timezoneOffset"),
          ),
  };
}
