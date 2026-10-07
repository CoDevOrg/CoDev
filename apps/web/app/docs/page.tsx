import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Getting started · CoDev" };

export default function DocsPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <Link href="/" className="text-sm text-muted-foreground">
        ← CoDev
      </Link>
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">DOCUMENTATION</p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Build together in CoDev
        </h1>
        <p className="text-muted-foreground">
          Your team and AI agents work in one shared cloud workspace.
        </p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Join the private beta</h2>
        <p>
          Start by joining the waitlist. We’ll email you when access is
          available.
        </p>
        <Link href="/#get-access" className="underline">
          Join the waitlist
        </Link>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Open a shared workspace</h2>
        <p>
          Bring your repository into a workspace. Your editor, terminal, Git,
          and agents use the same files.
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Work with your team and agents</h2>
        <p>
          Invite teammates, follow agent activity, and review changes together.
          Divide agent tasks across separate files to avoid duplicated work.
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Need a hand?</h2>
        <a href="mailto:admins@trycodev.com" className="underline">
          Contact the CoDev team
        </a>
      </section>
    </main>
  );
}
