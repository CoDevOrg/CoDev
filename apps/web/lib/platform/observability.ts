import "server-only";

const SECRET_KEY =
  /authorization|cookie|token|secret|credential|encrypted|prompt|contents|output|diff/i;

type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogValue[]
  | { [key: string]: LogValue };

function redact(value: LogValue, key = ""): LogValue {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redact(child, childKey),
      ]),
    );
  }
  if (typeof value === "string") {
    return value
      .replace(
        /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,})\b/g,
        "[REDACTED]",
      )
      .slice(0, 2_000);
  }
  return value;
}

export function requestId(request?: Request) {
  return (
    request?.headers.get("x-codev-request-id") ??
    request?.headers.get("x-vercel-id") ??
    crypto.randomUUID()
  );
}

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, LogValue> = {},
) {
  const record = redact({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: "codev-web",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "development",
    ...context,
  });
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
