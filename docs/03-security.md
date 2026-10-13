# 03 · Security architecture

## 1. Threat model (summary)

| Asset | Main threats | Primary controls |
|---|---|---|
| Customer accounts | credential stuffing, session theft, account enumeration | Argon2id, breached-password check, rate limits, httpOnly signed cookies, generic auth errors |
| Staff accounts (refunds, PII, prices) | phishing, session riding via storefront XSS, privilege abuse | Separate admin origin + cookie, mandatory TOTP, step-up re-auth, RBAC, audit log, 4-eyes on large refunds |
| Money (payments, refunds) | forged webhooks, replayed callbacks, amount tampering, double refunds | Signature verification, server-side inquiry, amount/currency match, idempotency, DB CHECKs |
| Stock and coupons | race conditions, coupon brute force | Atomic conditional updates, CHECKs, per-cart and per-IP limits |
| Customer PII (addresses, phones, payment proofs) | IDOR, leaks through logs or DTOs | Ownership-scoped queries, DTO allowlists, log redaction, private media with signed URLs, field encryption |
| Platform | XSS, injection, SSRF, supply chain, secret leakage | CSP, sanitisation, parameterised SQL only, outbound allowlist, locked dependencies, server-only env |
| Business (COD) | fake/prank COD orders, high RTO | Turnstile, phone verification, COD limits, risk rules, confirmation step |

## 2. Authentication

**Library:** Better Auth 1.7.7, configured in `packages/auth` as **two instances** that share the user tables:

| | Storefront (`novyra.pk`) | Admin (`admin.novyra.pk`) |
|---|---|---|
| Sign-up | Email + password, optional Google OAuth | **Disabled.** Staff are invited by an `owner`. The invite email sets a password. |
| Second factor | Optional TOTP | **Mandatory TOTP** (Better Auth `twoFactor` plugin). The admin guard forces enrolment before any page loads while `twoFactorEnabled` is false. Backup codes shown once. |
| Session lifetime | 30 days, sliding (`expiresIn` / `updateAge` 24 h) | 8 h sliding; absolute 12 h cap enforced by the admin guard from `session.createdAt` |
| Step-up | Password change, email change | `session.freshAge` = 10 min for refunds, role changes, payment-method config, exports |
| Cookie | `__Secure-novyra.session_token` | `__Host-novyra-admin.session_token` (host-only, no `Domain`) |
| Signing secret | `BETTER_AUTH_SECRET` | `ADMIN_BETTER_AUTH_SECRET` (different, so a storefront cookie can never validate on admin) |
| Access gate | — | `databaseHooks.session.create.before` rejects users without the `admin:access` permission. Every request re-checks permissions. |

**Password policy and hashing**
- Argon2id via `@node-rs/argon2`, wired into Better Auth `emailAndPassword.password.{hash,verify}`. Parameters: `memoryCost 19456 KiB, timeCost 2, parallelism 1` (OWASP minimum). Re-benchmark on production hardware and raise until hashing takes ~250 ms. Old hashes upgrade on next login.
- Minimum length 10, maximum 128. No composition rules. Checked against breached-password corpora with Better Auth's `haveIBeenPwned` plugin (k-anonymity: only a hash prefix leaves the server).
- Hashes live only in `accounts.password` and are never selected outside `packages/auth`.

**Account flows**
- Email verification is required before writing reviews or saving payment-relevant profile data. Guests can still check out without an account.
- Password reset: single-use token, 30-min expiry, stored by Better Auth in `verifications`. All other sessions are revoked on reset (`revokeSessionsOnPasswordReset`).
- **No account enumeration:** sign-in, sign-up and reset return the same message and similar timing whether or not the email exists.
- Sign-in from a new device → email notice. Staff sign-in → audit log entry.

## 3. Sessions and cookies

- Server-side sessions in `sessions`. The cookie holds `token.signature` (HMAC with the app's secret), so a DB leak alone can't mint cookies.
- Cookie flags: `HttpOnly; Secure; SameSite=Lax; Path=/`, `__Secure-` / `__Host-` prefixes. Admin cookies are host-only.
- Better Auth's short-lived signed cookie cache (5 min) cuts DB lookups. Revocation takes effect within that window.
- Sessions are revoked on: password change or reset, role change (all of that user's admin sessions), staff deactivation, "sign out of all devices".
- Session lists (device, IP, last seen) are visible to the user under *Account › Security*.

## 4. Authorization

### Two layers, never one

1. **`proxy.ts`** (Next 16's request proxy, formerly middleware) does only *cheap, non-authoritative* gating: redirect to sign-in when no session cookie exists, attach `x-request-id`. It is **not** a security boundary. CVE-2025-29927 (Next.js middleware bypass via the `x-middleware-subrequest` header) showed why.
2. **Authoritative checks run next to the data:** every Server Action, route handler and data loader calls `requireUser()` / `requirePermission(key)` from `packages/auth`. Core services take an explicit `actor` and check again for sensitive operations, so a new admin page that forgets a check still can't perform the operation.

### Ownership (IDOR protection)

Customer data is always fetched with the owner in the predicate: `where: { id, userId: session.user.id }`, never by ID alone.
Guest order tracking needs **either** a signed, expiring link from the confirmation email (HMAC over order ID + expiry)
**or** order number + the email/phone used at checkout, rate-limited. UUIDs are treated as identifiers, not secrets.

### Role-based access control

Permissions are code constants (`packages/auth/src/permissions.ts`), so a typo is a compile error. Roles are DB rows
the owner can edit. Built-in role templates:

| Permission | owner | store_manager | finance | fulfilment | support | content_editor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `admin:access`, `dashboard:view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `analytics:view` | ✓ | ✓ | ✓ | | | |
| `products:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `products:write`, `products:publish`, `content:manage`, `media:upload` | ✓ | ✓ | | | | ✓ |
| `inventory:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory:adjust` | ✓ | ✓ | | ✓ | | |
| `orders:read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `orders:update` (notes, COD verification, hold) | ✓ | ✓ | | ✓ | ✓ | |
| `orders:cancel` | ✓ | ✓ | | | ✓ | |
| `orders:export` | ✓ | ✓ | ✓ | | | |
| `customers:read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `customers:update` | ✓ | ✓ | | | ✓ | |
| `customers:erase` | ✓ | | | | | |
| `payments:read` | ✓ | ✓ | ✓ | | ✓ | |
| `payments:verify` (bank transfer, COD collection) | ✓ | ✓ | ✓ | | | |
| `refunds:create` | ✓ | ✓ | ✓ | | | |
| `refunds:approve` (above threshold, not own) | ✓ | | ✓ | | | |
| `shipments:manage` | ✓ | ✓ | | ✓ | | |
| `returns:manage` | ✓ | ✓ | | ✓ | ✓ | |
| `reviews:moderate` | ✓ | ✓ | | | ✓ | ✓ |
| `coupons:manage` | ✓ | ✓ | | | | |
| `settings:manage`, `shipping_settings:manage` | ✓ | ✓ | | | | |
| `payment_methods:manage` | ✓ | | ✓ | | | |
| `staff:manage` | ✓ | | | | | |
| `audit:read` | ✓ | | ✓ | | | |

Guard rails: staff can't change their own roles, the last `owner` can't be removed, refunds above
`settings.refund_approval_threshold` need a second person with `refunds:approve`, and every permission change is audited.

## 5. Input validation

- **One Zod schema per command** in `packages/validation`. The form uses it for UX and the server re-parses with the same schema for security. The server never trusts the client's parse.
- Schemas are strict: unknown keys rejected, strings trimmed and length-capped, enums closed, numbers bounded, quantities integer `1..99`.
- IDs validated as UUIDs, slugs as kebab-case, phones normalised to E.164 with `libphonenumber-js`, emails lower-cased.
- **Money never comes from the client.** Prices, discounts, shipping and totals are recomputed on the server (see 01 §4.3).
- Sorting and filtering: user input maps through an allowlist (`sort=price_asc` → `{ price: "asc" }`). It never becomes a column name.
- Body size limits: Server Actions `bodySizeLimit: "1mb"`, webhooks 256 KB, uploads go straight to storage (never through our functions).
- The database repeats the critical rules as CHECK constraints (see 02 §4).

## 6. Rate limiting and abuse prevention

Upstash Redis sliding windows, keyed by IP (from the platform's trusted header, never a client-supplied one) and,
where it makes sense, by account, email, cart or phone:

| Endpoint | Limits |
|---|---|
| Sign-in | 5 / 15 min per IP+email · 30 / 15 min per IP |
| Sign-up | 5 / h per IP |
| Password reset request | 3 / h per email · 10 / h per IP |
| TOTP verification | 5 / 15 min per user (+ Better Auth lockout) |
| Place order | 5 / 10 min per cart · 10 / 10 min per IP · 3 / day COD orders per phone (setting) |
| Apply coupon | 10 / 10 min per cart · 30 / h per IP (stops code guessing) |
| Guest order lookup | 10 / h per IP |
| Review submission | 5 / day per user |
| Newsletter sign-up | 5 / h per IP |
| Admin mutations | 120 / min per staff user · exports 5 / h |
| Webhooks | not IP-limited (provider IPs vary); bounded by body size + signature check + unique event IDs |

Cloudflare Turnstile guards sign-up, password reset, COD checkout, newsletter and review forms.
For COD there are also: an order-value cap and optional advance payment above a threshold (settings), WhatsApp/SMS order confirmation,
and a phone blocklist plus RTO-history flag that drops risky orders into `ON_HOLD`.

## 7. CSRF

| Surface | Protection |
|---|---|
| Server Actions | POST-only. Next.js compares `Origin` with `Host` and rejects mismatches. `serverActions.allowedOrigins` stays empty (no cross-origin callers). |
| Better Auth endpoints | Origin check against `trustedOrigins` (one origin per instance). |
| Cookie-authenticated route handlers | Shared `assertSameOrigin(request)` on every non-GET handler. No state change on GET. |
| Cookies | `SameSite=Lax` blocks cross-site POSTs carrying the session. |
| Webhooks / cron | No cookies are used. Authenticated by signature / bearer secret instead. |
| Payment return URLs | Some gateways return via cross-site POST. Those handlers read only the payment reference and change state only after server-to-server verification, so a forged POST can't mark anything paid. |

## 8. XSS

- React escapes all interpolated output. `dangerouslySetInnerHTML` is banned by ESLint, except in one `<SanitizedHtml>` component that only accepts HTML the catalog service sanitised **on write** (`sanitize-html` allowlist: p, h2–h4, ul/ol/li, strong/em, a[href=https/mailto], no attributes on others, no styles, no iframes).
- Reviews, notes and names are **plain text only**.
- JSON-LD (`Product`, `Offer`, `BreadcrumbList`) is serialised with `<`, `>`, `&`, U+2028 and U+2029 escaped.
- No SVG uploads (SVG can carry script). Only JPEG/PNG/WebP/AVIF images and PDF proofs.
- `HttpOnly` session cookies, so even a successful XSS can't read the session.
- Content Security Policy (see §12). Admin also gets a nonce-based `'strict-dynamic'` policy.

## 9. Injection

- **SQL:** Prisma parameterises every query. Raw SQL is allowed only through the tagged templates `$queryRaw` / `$executeRaw`, which parameterise automatically. `$queryRawUnsafe` / `$executeRawUnsafe` are banned by lint. Dynamic identifiers come only from code allowlists.
- **OS commands:** the application never shells out.
- **Email / HTTP headers:** messages are sent through provider APIs with structured fields. CR/LF are stripped from any user value used in a subject or header.
- **Path traversal:** storage keys are generated on the server (`products/<uuid>.<ext>`). User filenames are kept only as metadata.
- **Log injection:** JSON-structured logs, never string concatenation.
- **SSRF:** the server never fetches user-supplied URLs. Outbound HTTP goes through one `fetch` wrapper with a per-integration host allowlist, timeouts and no redirects to other hosts.
- **Open redirect:** `callbackURL` / `returnTo` must be relative paths starting with a single `/`.

## 10. Secure API endpoints

The only HTTP endpoints are:

| Route | Auth | Extra controls |
|---|---|---|
| `/api/auth/*` | Better Auth | origin check, rate limit, Turnstile on sign-up/reset |
| `/api/webhooks/payments/[provider]` | provider signature | raw body, constant-time compare, unique event id, amount check |
| `/api/webhooks/shipping/[provider]` | provider signature / shared secret | as above |
| `/api/webhooks/notifications/[provider]` | Resend (Svix) signature, WhatsApp `X-Hub-Signature-256` | as above |
| `/api/payments/[provider]/return` | none (customer browser) | only reads the reference, then triggers server-side verification, then redirects to a status page |
| `/api/cron/[job]` | `Authorization: Bearer CRON_SECRET` (constant-time) | job allowlist |
| `/api/internal/dispatch` | HMAC-SHA256 (`INTERNAL_API_SECRET`) over timestamp + body, ±5 min skew | admin → storefront only |
| `/api/health` | none | returns `ok` / `degraded` only, no internals |

Everything else is a Server Action and goes through the `defineAction()` pipeline (01 §4.2). Errors come back as
typed codes. Stack traces, SQL and provider messages never reach the client. Unknown routes return 404.

## 11. Webhook verification, idempotency and payment integrity

Every inbound webhook is handled the same way:

```
read raw body (no JSON re-serialisation)
 → provider.verifyWebhook(): HMAC/signature over raw body, constant-time compare, timestamp tolerance where supported
     ✗ → 401, log + metric, nothing stored
 → INSERT webhook_events (provider, external_id) — duplicate → 200 "already processed"
 → in one transaction: lock payment / shipment row, check amount + currency + current state,
   apply allowed transition only (state machine), write ledger event + outbox
 → 200 quickly (heavy work happens in outbox handlers)
```

- Some Pakistani gateways sign callbacks with a shared salt over the request fields rather than a signed event. For those, the callback is treated as a **hint** and the authoritative status comes from the gateway's server-to-server **status inquiry API** before money state changes.
- Out-of-order events are safe: transitions only move forward (e.g. `CAPTURED` is never overwritten by a late `PENDING`).
- **Idempotency everywhere money or stock moves:** checkout (client key + `idempotency_keys`), payment initiation (`payments.idempotency_key`, passed to providers that support it), refunds (`refunds.idempotency_key`), courier bookings (`booking_idempotency_key` + lookup-by-reference before retrying a timed-out booking), notifications (`dedupe_key`), webhooks (`webhook_events` unique). A replayed key with a different request body returns 422.
- **PCI DSS scope:** card data never touches NOVYRA servers. Only provider-hosted pages or provider-hosted fields are used (SAQ A). PAN, CVV, wallet PINs and OTPs are never logged or stored.

## 12. Security headers

Set in each app's `next.config.ts` `headers()` (CSP for admin is built per request in `proxy.ts` with a nonce):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` (also `frame-ancestors 'none'`) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self)` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` (storefront, wallet pop-ups) · `same-origin` (admin) |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `X-Powered-By` | removed (`poweredByHeader: false`) |
| Cache | `Cache-Control: private, no-store` on account, checkout and all admin responses |

**Content-Security-Policy, storefront** (allowlist; final host list fixed when the gateway is chosen):

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://res.cloudinary.com https://*.google-analytics.com https://*.googletagmanager.com https://www.facebook.com;
font-src 'self';
connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://api.cloudinary.com https://*.ingest.sentry.io;
frame-src https://challenges.cloudflare.com <embedded-gateway-origin>;
form-action 'self' <hosted-checkout-origins>;
frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests
```

> **Decision:** a nonce-based CSP forces every page to render dynamically, which would cost the cached catalog its speed.
> The storefront starts with an allowlist CSP and `'unsafe-inline'` scripts. No staff session exists there and the
> customer session cookie is `HttpOnly`. **Admin** uses `script-src 'nonce-…' 'strict-dynamic'` with no `'unsafe-inline'`.
> Revisit the storefront policy if Next.js adds hash-based CSP for prerendered pages.
>
> `form-action` must list the gateway's hosted-checkout origin. Redirect-POST gateways (common in Pakistan) fail without it.

## 13. Secrets and environment variables

- **All secrets are server-only env vars**, validated at build and boot by `packages/env` (Zod). Missing or invalid → the app refuses to start. The full list is in [09-environment.md](09-environment.md).
- **Only `NEXT_PUBLIC_*` vars reach the browser**, and the env package's client schema allowlists exactly which ones. Each is a public identifier (site URL, GA measurement ID, Pixel ID, Turnstile site key, Cloudinary cloud name, Sentry DSN).
- `packages/env/server.ts`, `packages/auth`, `packages/core` and `packages/db` import `server-only`, so bundling them for the client fails the build.
- React's taint API (`experimental.taint`) marks secret values and server-only objects so they can't be passed to Client Components by accident.
- Integration secrets (gateways, couriers, email) live **only** in env. The DB stores non-secret config (`payment_methods.settings`). Admin can't enable a provider whose env isn't configured.
- Field-level encryption: `refunds.payout_details_encrypted` uses AES-256-GCM with `DATA_ENCRYPTION_KEY`, ciphertext prefixed with a key version (`v1:`) so keys can rotate.
- Separate secrets per environment. Production secrets live only in the hosting provider's encrypted env store, with access limited to the owner.
- **CI:** gitleaks secret scanning on every PR. `.env*` files are git-ignored (only `.env.example` is committed).
- **Database roles:** `novyra_app` (DML only, used at runtime), `novyra_migrator` (DDL, used by the release pipeline), `novyra_readonly` (reporting). The runtime role can't drop tables or disable the append-only triggers.

## 14. Uploads, PII and logging

- Uploads are direct-to-storage with **signed, short-lived upload tickets** that fix folder, max size and MIME type. Afterwards the server re-reads the object's metadata from the provider before creating `media_assets`.
- Payment proofs and shipping labels are `PRIVATE`. They're reachable only through signed URLs with a ≤ 5 min TTL, issued to the owning customer or staff with the right permission.
- Logs redact passwords, tokens, cookies, secrets, emails, phones, IBANs and card-like numbers (pino `redact`). Sentry has PII scrubbing on.
- The **audit log** records every staff mutation, permission denial, auth failure, webhook signature failure and data export, with actor, IP, user agent and request ID.

## 15. Supply chain and delivery

- Exact dependency pins + committed lockfile, `allowBuilds` allowlist for install scripts, Renovate grouped updates, `pnpm audit` gate.
- GitHub Actions pinned to commit SHAs. Least-privilege `GITHUB_TOKEN`. Production deploys only from protected `main` with required review + green CI.
- Pre-launch: OWASP ASVS L2 checklist, authorisation matrix tests (every admin action called with every role), dependency review, and a third-party penetration test before taking card payments.
