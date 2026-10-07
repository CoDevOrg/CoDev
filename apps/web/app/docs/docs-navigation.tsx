import Link from "next/link";
import { guides } from "./docs-content";

export function DocsNavigation({ outline = false }: { outline?: boolean }) {
  return (
    <nav
      className={outline ? "docs-toc" : "docs-sidebar"}
      aria-label={outline ? "On this page" : "Documentation"}
    >
      <p className="docs-eyebrow">
        {outline ? "ON THIS PAGE" : "GETTING STARTED"}
      </p>
      <Link href="#overview">Overview</Link>
      {guides.map(({ id, title }) => (
        <Link key={id} href={`#${id}`}>
          {title}
        </Link>
      ))}
      {!outline ? <p className="docs-eyebrow">SUPPORT</p> : null}
      <Link href="#help">Get help</Link>
      {!outline ? <Link href="/pricing">Pricing</Link> : null}
    </nav>
  );
}
