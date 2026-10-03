const PROGRESS_LIMIT = 32 * 1_024;

const ANSI = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const PRIVATE_PATH =
  /\/(?:var\/lib\/codev-agent-profiles|workspace\/\.codev-agent-profiles)\b|(?:^|\s)\.\s+['"]?\/.*launch\.sh/i;
const SECRET_LINE =
  /(?:CODEX_HOME|CLAUDE_CONFIG_DIR|SUPERSET_ACCOUNT_ATTRIBUTION_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|authorization)\s*[=:]/i;
const SECRET_VALUE =
  /(?:Bearer\s+|(?:sk|sess|ghp|github_pat)_[A-Za-z0-9_-]+|"(?:access_token|refresh_token|api_key|token)"\s*:\s*")[^\s",}]+/gi;

function capProgress(text: string) {
  if (text.length <= PROGRESS_LIMIT) return text;
  const half = Math.floor(PROGRESS_LIMIT / 2);
  return `${text.slice(0, half)}\n… output truncated …\n${text.slice(-half)}`;
}

/** Remove private launch details and token-shaped values before persistence. */
export function filterSupersetAgentOutput(output: string) {
  const lines = output.replace(ANSI, "").replaceAll("\r", "").split("\n");
  const safe = lines.flatMap((line) => {
    if (PRIVATE_PATH.test(line) || SECRET_LINE.test(line)) {
      return ["[private agent data removed]"];
    }
    return [line.replace(SECRET_VALUE, "[redacted]")];
  });
  return capProgress(safe.join("\n"));
}
