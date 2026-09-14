import "../../../settings/orca-theme.css";

/**
 * The activity feed is built entirely from the Orca design-system components
 * (`OrcaPageShell`, `OrcaPageHeader`, `OrcaCard`) and the Tailwind utilities
 * they expect — but it lives under `/workspaces`, which is plain-CSS territory
 * and loads none of them. Every utility class on the page was inert, so it
 * rendered as unstyled markup at default browser sizes.
 *
 * Bringing the stylesheet to the page it was written for is the honest fix:
 * the alternative is restating a working design system in hand-written CSS.
 * The import is scoped to this route segment, and `orca-settings-scope` gates
 * the reset, so nothing outside this page is touched.
 */
export default function WorkspaceActivityLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="orca-settings-scope">{children}</div>;
}
