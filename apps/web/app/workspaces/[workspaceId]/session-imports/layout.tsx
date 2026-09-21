import "../../../settings/orca-theme.css";

export default function WorkspaceSessionImportsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="orca-settings-scope">{children}</div>;
}
