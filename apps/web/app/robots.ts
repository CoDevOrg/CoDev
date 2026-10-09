import type { MetadataRoute } from "next";
import { PUBLIC_APP_ORIGIN } from "@/lib/platform/site-hosts";

/** Marketing, docs, and legal pages are public; signed-in app surfaces are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/gen2",
        "/rooms",
        "/settings",
        "/invite",
        "/room-invites",
        "/cli",
        "/verification",
        "/reset-password",
        "/forgot-password",
      ],
    },
    sitemap: `${PUBLIC_APP_ORIGIN}/sitemap.xml`,
    host: PUBLIC_APP_ORIGIN,
  };
}
