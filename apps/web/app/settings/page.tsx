import { redirect } from "next/navigation";

/** `/settings` sends members to their personal settings landing page. */
export default function SettingsPage() {
  redirect("/settings/personal/profile");
}
