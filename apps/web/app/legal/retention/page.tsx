export default function DataRetentionPage() {
  return (
    <main className="settings-page">
      <h1>Data retention</h1>
      <p>
        Hosted Codex connection metadata is retained while the connection is
        active. Disconnecting revokes upstream access when supported, deletes
        encrypted material, and invalidates outstanding runtime grants.
      </p>
    </main>
  );
}
