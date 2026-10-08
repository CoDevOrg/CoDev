import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { guides } from "./docs-content";

export function DocsOverview() {
  return (
    <section id="overview" className="docs-overview">
      <p className="docs-eyebrow">DOCUMENTATION</p>
      <h1>Build together in CoDev.</h1>
      <p className="docs-intro">
        Your team and AI agents, in one cloud workspace. Share an editor, run
        commands, and review what you’re building together.
      </p>
      <div className="docs-guide-grid">
        {guides.map(({ id, title, summary, icon: Icon }) => (
          <Link href={`#${id}`} key={id} className="docs-guide-link">
            <Card>
              <CardHeader>
                <Icon className="docs-guide-icon" aria-hidden="true" />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{summary}</CardDescription>
              </CardHeader>
              <CardFooter>
                Read the guide <ArrowUpRight size={14} aria-hidden="true" />
              </CardFooter>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
