import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReelDemo } from "@/components/reel-demo/reel-demo";
import {
  isReelScene,
  type ReelSceneName,
} from "@/components/reel-demo/timeline";

export const metadata: Metadata = {
  title: "Reel Demo",
  description: "A synthetic CoDev collaboration demo for local recording.",
  robots: { index: false, follow: false },
};

// The environment gate must be evaluated when the page is requested. A static
// prerender would bake the build machine's flag into every later environment.
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReelDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const isVercelDeployment =
    process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.CODEV_ENABLE_REEL_DEMO !== "true" || isVercelDeployment)
  ) {
    notFound();
  }

  const params = await searchParams;
  const requestedScene = first(params.scene);
  const scene: ReelSceneName = isReelScene(requestedScene)
    ? requestedScene
    : "open";

  return (
    <ReelDemo
      initialAutoplay={first(params.autoplay) !== "0"}
      initialControls={first(params.controls) !== "0"}
      initialLoop={first(params.loop) !== "0"}
      initialScene={scene}
    />
  );
}
