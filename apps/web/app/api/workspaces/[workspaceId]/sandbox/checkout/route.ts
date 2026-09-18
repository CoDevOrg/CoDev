import { z } from "zod";

import { apiError } from "@/lib/api";
import { withWorkspace } from "@/lib/api-route";
import { executeInSandbox } from "@/lib/orchestrator";

const bodySchema = z.object({
  branch: z
    .string()
    .min(1)
    .max(256)
    // Only allow safe branch name characters to prevent shell injection
    .regex(/^[a-zA-Z0-9._\-/]+$/, "Branch name contains invalid characters."),
});

export const POST = withWorkspace("edit", async ({ request, workspaceId }) => {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return apiError(new Error("Invalid request body."), 400);
  }

  try {
    const result = await executeInSandbox(workspaceId, {
      command: ["git", "checkout", body.branch],
      timeoutSeconds: 30,
    });

    if (result.exitCode !== 0) {
      return Response.json(
        { error: result.output || "git checkout failed." },
        { status: 422 },
      );
    }

    // Get the new HEAD sha after checkout
    const shaResult = await executeInSandbox(workspaceId, {
      command: ["git", "rev-parse", "HEAD"],
      timeoutSeconds: 10,
    });
    const headSha = shaResult.output.trim();

    return Response.json({ branch: body.branch, headSha });
  } catch (error) {
    return apiError(error);
  }
});
