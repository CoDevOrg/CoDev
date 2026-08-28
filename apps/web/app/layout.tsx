import type { Metadata } from "next";
import {
  Archivo,
  Geist,
  Geist_Mono,
  Instrument_Serif,
  JetBrains_Mono,
} from "next/font/google";

import "./globals.css";
import "./app-theme.css";

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

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
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
  const content = (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
      >
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
