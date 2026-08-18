export default function PrivacyNoticePage() {
  return (
    <main className="settings-page">
      <h1>Privacy notice</h1>
      <p>
        CoDev stores the official Codex authentication cache encrypted with a
        dedicated credential key. The browser never receives it. A private,
        owner-only temporary copy is provided to the official Codex process in
        an isolated AWS workspace for the duration of one agent execution, then
        deleted.
      </p>
    </main>
  );
}
