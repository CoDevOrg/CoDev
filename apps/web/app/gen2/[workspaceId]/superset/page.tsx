import { redirect } from "next/navigation";

export default async function Gen2SupersetPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(`/gen2/${workspaceId}`);
}
