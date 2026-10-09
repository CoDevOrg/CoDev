import type { MetadataRoute } from "next";
import { PUBLIC_APP_ORIGIN } from "@/lib/platform/site-hosts";

const PAGES: Array<[path: string, priority: number]> = [
  ["/", 1],
  ["/pricing", 0.8],
  ["/docs", 0.8],
  ["/legal/terms", 0.2],
  ["/legal/privacy", 0.2],
  ["/legal/cookies", 0.2],
  ["/legal/refunds", 0.2],
  ["/legal/retention", 0.2],
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(([path, priority]) => ({
    url: `${PUBLIC_APP_ORIGIN}${path === "/" ? "" : path}`,
    priority,
  }));
}
