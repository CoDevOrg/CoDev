import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import "./theme-tokens.css";
import "./globals.css";
import "./app-theme.css";

import { VisitTracker } from "@/components/landing/visit-tracker";
import { THEME_INIT_SCRIPT } from "@/components/shell/theme-toggle";

const sans = Inter_Tight({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Base for resolving the relative social image on the landing page. Without
 * it Next falls back to the opaque per-deployment vercel.app host, so a shared
 * link from production would not point at trycodev.com. Mirrors the
 * environment split already used by `lib/auth/auth-cookie.ts`.
 */
function metadataBase(): URL {
  if (process.env.VERCEL_ENV === "production") {
    return new URL("https://trycodev.com");
  }
  if (process.env.VERCEL_URL) {
    return new URL(`https://${process.env.VERCEL_URL}`);
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  title: {
    default: "CoDev",
    template: "%s · CoDev",
  },
  description:
    "A hosted browser workspace where people and AI agents build together.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Stamps an explicit stored theme choice before first paint, so a
            returning dark-mode visitor never sees a light flash. Nothing to
            do when no choice is stored -- the CSS `prefers-color-scheme`
            query already handles that case without JS. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${sans.variable} ${mono.variable}`}>
        {children}
        <Analytics />
        <Suspense fallback={null}>
          <VisitTracker />
        </Suspense>
      </body>
    </html>
  );
}
