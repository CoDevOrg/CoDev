export default function DataRetentionPage() {
  return (
    <main className="settings-page">
      <h1>Data retention</h1>
      <p>
        Hosted Codex connection metadata is retained while the connection is
        active. Disconnecting deletes encrypted material and immediately blocks
        new cloud executions. Temporary workspace copies are deleted when the
        Codex process exits and are never written to workspace snapshots.
      </p>
    </main>
  );
}
