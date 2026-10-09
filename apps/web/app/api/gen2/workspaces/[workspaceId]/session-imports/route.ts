import { gen2SessionImportProviderSchema } from "@codev/contracts";

import { ApiError, withUser } from "@/lib/http/api-route";
import { previewGen2SessionImport } from "@/lib/gen2/session-import";
import { SESSION_IMPORT_MAX_BYTES } from "@/lib/gen2/session-import-parse";
import { consumeRateLimit } from "@/lib/platform/rate-limit";

type Params = { workspaceId: string };

/** Uploads a local agent session and returns its preview as a draft. */
export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const provider = gen2SessionImportProviderSchema.safeParse(
      form?.get("provider"),
    );
    if (!(file instanceof File) || !provider.success) {
      throw new ApiError("Choose an agent and a session file.");
    }
    if (file.size > SESSION_IMPORT_MAX_BYTES) {
      throw new ApiError("Session files can be up to 64 MB.", 413);
    }
    const limit = await consumeRateLimit(
      user.id,
      "gen2-session-import",
      10,
      60 * 60,
    );
    if (!limit.allowed) {
      throw new ApiError("Too many imports. Try again later.", 429);
    }
    const preview = await previewGen2SessionImport({
      workspaceId,
      userId: user.id,
      provider: provider.data,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ preview }, { status: 201 });
  },
  { errorStatus: 500 },
);
