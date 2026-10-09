import { describe, expect, it } from "vitest";

import { redactSessionJsonl } from "./session-import-redact";

const line = (value: unknown) => JSON.stringify(value);

describe("session import redaction", () => {
  it("hides each known secret format and counts it", () => {
    const secrets = [
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
      "sk-proj-abcdefghijklmnopqrstuvwxyz0123",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "AKIAABCDEFGHIJKLMNOP",
      "xoxb-1234567890-abcdefghij",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
      "postgres://codev:hunter22@db.example.com/codev",
      "DATABASE_PASSWORD=Xk29fjQ81mLp0",
    ];
    const { text, redactions } = redactSessionJsonl(
      secrets.map((secret) => line({ text: secret })).join("\n"),
    );
    for (const secret of secrets) {
      expect(text).not.toContain(secret.split(/[:=]/).at(-1));
    }
    expect(text).toContain("postgres://codev:[REDACTED]@db.example.com");
    expect(text).toContain("DATABASE_PASSWORD=[REDACTED]");
    expect(redactions.map((r) => r.kind).sort()).toEqual(
      [
        "AWS key",
        "Anthropic key",
        "GitHub token",
        "JWT",
        "OpenAI key",
        "Slack token",
        "connection string password",
        "private key",
        "secret assignment",
      ].sort(),
    );
  });

  it("leaves references, identifiers, and encrypted reasoning alone", () => {
    const original = [
      line({ text: "AUTH_SECRET: process.env.AUTH_SECRET" }),
      line({ text: "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}" }),
      line({ text: "API_KEY_ENV: OPENAI_API_KEY" }),
      line({ encrypted_content: "sk-proj-abcdefghijklmnopqrstuvwxyz0123" }),
      "not json",
    ].join("\n");
    expect(redactSessionJsonl(original)).toEqual({
      text: original,
      redactions: [],
    });
  });

  it("keeps the session header and line structure intact", () => {
    const header = line({
      type: "session_meta",
      payload: { id: "01a0fb8e-879a-7a12-8eeb-e52297ff6ffa" },
    });
    const body = line({
      payload: { output: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz12" },
    });
    const { text } = redactSessionJsonl(`${header}\n${body}\n`);
    const lines = text.split("\n");
    expect(lines[0]).toBe(header);
    expect(JSON.parse(lines[1]!)).toEqual({
      payload: { output: "OPENAI_API_KEY=[REDACTED]" },
    });
    expect(lines[2]).toBe("");
  });
});
