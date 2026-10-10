import { PUBLIC_APP_ORIGIN } from "./site-hosts";

/** Frames the app may load: workspace previews, and local dev servers in development. */
function frameSources(production: boolean, previewZone: string | null) {
  const sources = [
    ...(previewZone ? [`https://*.${previewZone}`] : []),
    ...(production ? [] : ["http://localhost:*", "http://127.0.0.1:*"]),
  ];
  return sources.length ? [`frame-src 'self' ${sources.join(" ")}`] : [];
}

/**
 * Common browser protections; request nonces authorize framework inline
 * scripts. The proxy passes the validated preview zone: this module is also
 * evaluated at build time by next.config.ts, so it reads no environment.
 */
export function securityHeaders(
  nonce?: string,
  production = process.env.NODE_ENV === "production",
  origin = PUBLIC_APP_ORIGIN,
  previewZone: string | null = null,
) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // Dictation needs the microphone; previews are framed with allow="".
      value: "camera=(), microphone=(self), geolocation=()",
    },
  ];
  if (production)
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
  if (!nonce) return headers;
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${PUBLIC_APP_ORIGIN} ${new URL(origin).origin.replace(/^http/, "ws")} https://*.supabase.co wss://*.supabase.co${production ? "" : " ws: http://127.0.0.1:* http://localhost:*"}`,
    ...frameSources(production, previewZone),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${PUBLIC_APP_ORIGIN} https://github.com https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com`,
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ];
  headers.push({ key: "Content-Security-Policy", value: policy.join("; ") });
  return headers;
}
