import { z } from "zod";

export const accountDeletionSchema = z.object({
  confirmation: z.literal("DELETE"),
  token: z.string().min(1).max(2048),
});
