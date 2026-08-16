export default function PrivacyNoticePage() {
  return (
    <main className="settings-page">
      <h1>Privacy notice</h1>
      <p>
        CoDev stores hosted Codex subscription material only on the server,
        encrypted with a dedicated credential key. The browser never receives
        access tokens, refresh tokens, authorization codes, or runtime grants.
      </p>
    </main>
  );
}
