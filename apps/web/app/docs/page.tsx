import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { buttonClassName } from "@/components/ui/button";
import { DocsOverview } from "./docs-overview";
import { DocsGuides } from "./docs-guides";
import { DocsNavigation } from "./docs-navigation";
import "./docs.css";
import "./docs-responsive.css";

export const metadata: Metadata = {
  title: "Documentation · CoDev",
  description:
    "Get started with CoDev: invite your team, connect your AI subscriptions, and build together in a shared cloud workspace.",
};

export default function DocsPage() {
  return (
    <div className="docs-page">
      <a className="docs-skip" href="#docs-main">
        Skip to content
      </a>
      <header className="docs-header">
        <div className="docs-header-inner">
          <Link href="/" className="docs-brand" aria-label="CoDev home">
            <Image src="/brand/codev-mark.svg" alt="" width={28} height={28} />
            <strong>CoDev</strong>
            <span>/</span>
            <span>Docs</span>
          </Link>
          <Link
            href="/#get-access"
            className={buttonClassName({ variant: "default", size: "sm" })}
          >
            Join the waitlist
          </Link>
        </div>
      </header>
      <div className="docs-layout">
        <DocsNavigation />
        <main id="docs-main">
          <DocsOverview />
          <DocsGuides />
        </main>
        <DocsNavigation outline />
      </div>
    </div>
  );
}
