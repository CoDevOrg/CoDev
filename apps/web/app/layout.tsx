import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import "./globals.css";
import "./app-theme.css";
import "./team-chat.css";

import { VisitTracker } from "@/components/landing/visit-tracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <Analytics />
        <Suspense fallback={null}>
          <VisitTracker />
        </Suspense>
      </body>
    </html>
  );
}
