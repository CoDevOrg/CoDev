import type { Metadata } from "next";
import Link from "next/link";
import "@/app/product-theme.css";

export const metadata: Metadata = { robots: { index: true, follow: true } };

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12 text-sm leading-7">
      <nav
        aria-label="Legal pages"
        className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground"
      >
        <Link href="/">CoDev</Link>
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/refunds">Refunds</Link>
        <Link href="/legal/retention">Retention</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </nav>
      <article className="space-y-6 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_section]:space-y-2 [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </article>
      <footer className="space-y-2 border-t border-border pt-6 text-muted-foreground">
        <p>CoDev</p>
        <p>
          Privacy, billing and support:{" "}
          <a className="underline" href="mailto:admins@trycodev.com">
            admins@trycodev.com
          </a>
        </p>
        <p>Policy version: October 4, 2026.</p>
      </footer>
    </main>
  );
}
