import { PUBLIC_APP_ORIGIN } from "./site-hosts";

/** Common browser protections; request nonces authorize framework inline scripts. */
export function securityHeaders(
  nonce?: string,
  production = process.env.NODE_ENV === "production",
  origin = PUBLIC_APP_ORIGIN,
) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
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
