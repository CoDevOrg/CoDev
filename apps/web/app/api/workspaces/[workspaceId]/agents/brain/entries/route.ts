import { brainEntryKindSchema, recordBrainEntrySchema } from "@codev/contracts";
import { z } from "zod";

import { withWorkspace } from "@/lib/http/api-route";
import {
  listBrainEntries,
  recordBrainEntry,
} from "@/lib/coordination/workspace-brain";

const postBodySchema = recordBrainEntrySchema.extend({
  sessionId: z.uuid().optional(),
});

export const GET = withWorkspace("view", async ({ request, workspaceId }) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || undefined;
  const kindsParam = url.searchParams
    .getAll("kind")
    .map((value) => brainEntryKindSchema.safeParse(value))
    .flatMap((result) => (result.success ? [result.data] : []));
  return Response.json({
    entries: await listBrainEntries(workspaceId, {
      limit: 60,
      ...(query ? { query } : {}),
      ...(kindsParam.length ? { kinds: kindsParam } : {}),
    }),
  });
});

export const POST = withWorkspace(
  "coSteer",
  async ({ request, user, workspaceId }) => {
    const { sessionId, ...entry } = postBodySchema.parse(await request.json());
    return Response.json(
      {
        entry: await recordBrainEntry(
          workspaceId,
          sessionId ?? null,
          user.id,
          entry,
        ),
      },
      { status: 201 },
    );
  },
);
