import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "@xterm/xterm/css/xterm.css";
import "./globals.css";

import { clerkAuthConfigured } from "@/lib/identity";
import { AppClerkProvider } from "@/components/clerk-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CoDev — One workspace. Two builders.",
    template: "%s · CoDev",
  },
  description:
    "A hosted, browser-based engineering workspace where people and AI agents build together.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
  return clerkAuthConfigured() ? (
    <AppClerkProvider>{content}</AppClerkProvider>
  ) : (
    content
  );
}
