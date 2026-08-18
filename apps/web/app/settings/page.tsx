import { redirect } from "next/navigation";

/**
 * `/settings` has no content of its own; it always meant "my personal
 * settings," so send visitors straight to the profile page. This route used
 * to render personal settings inside a live Orca IDE session so members saw
 * the same settings UI whether or not a workspace was open, but that made
 * "can I open Settings" depend on the AWS host, the orchestrator, and a per-
 * user sandbox process — infrastructure with nothing to do with reading a
 * profile or pasting an API key, and a reliability class no settings page
 * should inherit.
 */
export default function SettingsPage() {
  redirect("/settings/personal/profile");
}
