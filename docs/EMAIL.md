# Domain email (`trycodev.com`)

CoDev’s public site is `trycodev.com` (and `www.trycodev.com`). The domain is
registered with Vercel, uses Vercel nameservers, and is attached to the
`codev` Vercel project. Email on this domain is two separate systems: Resend
for outbound product mail, and ImprovMX for inbound operator mailboxes.

There is no hosted mailbox (no IMAP, no Google Workspace). Receiving is free
forwarding. Sending product mail does not use ImprovMX.

## What is live

| Address                | Role                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `noreply@trycodev.com` | Product From address (password resets, waitlist receipts, invites) via Resend          |
| `yousef@trycodev.com`  | Operator inbox. ImprovMX forwards it to the Gmail configured in the ImprovMX dashboard |
| `*@trycodev.com`       | Catch-all. Same ImprovMX destination as `yousef@`                                      |

ImprovMX is on the free plan. Do not upgrade to Premium unless you need SMTP
to _send_ from `yousef@trycodev.com`. Receiving does not require it.

## Outbound (Resend)

The website sends mail with `RESEND_API_KEY` through `https://api.resend.com/emails`.

- From: `AUTH_EMAIL_FROM`, defaulting to `CoDev <noreply@trycodev.com>`
- Used by `apps/web/lib/password-reset-mail.ts` and `apps/web/lib/access-request-mail.ts`

Resend is verified on `trycodev.com`. Its DNS lives on the `send` subdomain and
`resend._domainkey`, so it does not conflict with apex MX used for receiving.

| Name                | Type | Value                                       |
| ------------------- | ---- | ------------------------------------------- |
| `resend._domainkey` | TXT  | Resend DKIM public key                      |
| `send`              | TXT  | `v=spf1 include:amazonses.com ~all`         |
| `send`              | MX   | `10 feedback-smtp.us-east-1.amazonses.com.` |

Keep the From address on `@trycodev.com`. Changing it to an unrelated domain
will fail Resend domain checks.

## Inbound (ImprovMX)

Set up 2026-08-30:

1. Create a free ImprovMX account at [app.improvmx.com](https://app.improvmx.com).
2. Add domain `trycodev.com` (not `codev.com` — that domain is not ours).
3. Add alias `yousef` → the operator Gmail. A catch-all `*` was also added.
4. Add apex MX and SPF on Vercel DNS (below).
5. In ImprovMX, wait until `trycodev.com` shows **Active**.

To add another address later (`hello@trycodev.com`, and so on), create another
alias in ImprovMX. Apex MX does not need to change.

## Vercel DNS for receiving

Added with the Vercel CLI while nameservers were `ns1.vercel-dns.com` /
`ns2.vercel-dns.com`:

```sh
vercel dns add trycodev.com @ MX mx1.improvmx.com 10
vercel dns add trycodev.com @ MX mx2.improvmx.com 20
vercel dns add trycodev.com @ TXT "v=spf1 include:spf.improvmx.com ~all"
```

| Name | Type | Value                                  |
| ---- | ---- | -------------------------------------- |
| `@`  | MX   | `10 mx1.improvmx.com.`                 |
| `@`  | MX   | `20 mx2.improvmx.com.`                 |
| `@`  | TXT  | `v=spf1 include:spf.improvmx.com ~all` |

There must be only one apex SPF TXT record. If another sender later needs apex
SPF (Gmail “Send mail as”, Google Workspace, and so on), merge the `include:`
mechanisms into that single record. Do not add a second SPF TXT. Resend’s SPF
stays on `send` and does not need to be merged today.

Vercel also has an **ImprovMX** DNS preset that writes the same MX/SPF records.

## App environment

Documented in `.env.example`. Local values live in `.env.local` and
`apps/web/.env.local` (gitignored).

| Variable                      | Purpose                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `RESEND_API_KEY`              | Required in production to actually send mail                        |
| `RESEND_EMAIL_DOMAIN`         | Present on the Vercel project; unused by app code                   |
| `AUTH_EMAIL_FROM`             | Optional From header. Default `CoDev <noreply@trycodev.com>`        |
| `ACCESS_REQUEST_NOTIFY_EMAIL` | Optional. Waitlist requests are forwarded here                      |
| `SIGNUP_ALLOWLIST`            | Optional comma-separated emails that may register without an invite |

`ACCESS_REQUEST_NOTIFY_EMAIL` and `SIGNUP_ALLOWLIST` are set locally to
`yousef@trycodev.com`. Production Vercel still needs the same keys if waitlist
pings and allowlisted signup should work on trycodev.com.

Do not put `yousef@trycodev.com` in `AUTH_EMAIL_FROM`. That variable is the
Resend From address for product mail, not the operator inbox.

## Checks

```sh
vercel domains inspect trycodev.com
vercel dns ls trycodev.com
dig +short MX trycodev.com
dig +short TXT trycodev.com
```

MX should be ImprovMX. Apex TXT should be the ImprovMX SPF record. Then send a
message to `yousef@trycodev.com` from a different account and confirm it lands
in the ImprovMX destination Gmail.

## Do not

- Point nameservers away from Vercel without re-creating both Resend and
  ImprovMX records at the new DNS host. The website aliases depend on Vercel
  nameservers today.
- Add a second apex MX provider (Google, Zoho, Cloudflare Email Routing) while
  ImprovMX is active. One set of apex MX records wins.
- Pay ImprovMX Premium only to receive mail.
