import "../../../settings/orca-theme.css";
import "./session-imports.css";

export default function WorkspaceSessionImportsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="orca-settings-scope session-imports-theme">{children}</div>
  );
}
