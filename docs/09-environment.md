# 09 · Environment variables

Rules:

- **Secret** vars are read only on the server (`packages/env/src/server.ts`, which imports `server-only`).
- **Public** vars must start with `NEXT_PUBLIC_` and be listed in `packages/env/src/client.ts`. They're compiled into browser bundles, so they're never secrets.
- **Validation** (Zod, `packages/env/src/schema.ts`): each app's `dev`, `build` and `start` script runs `check-env` first, which exits 1 and names every problem when a *required* var is missing or invalid. A bad deploy therefore fails its build instead of going live. The instrumentation hook re-checks at runtime; if that fails, every request answers 500 rather than running misconfigured. Today the validated set is the Core table below (`APP_ENV`, `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_URL`, plus the deployment secrets in staging and production), and both apps validate the same set. Each later phase adds its variables to `packages/env`.
- **One `.env` at the repository root** for local development. The Prisma CLI, seed, tests and both apps read it (the apps through `with-root-env`). Variables already exported in the shell win. CI and hosting set real environment variables and have no `.env`.
- **Turborepo strict env mode:** turbo tasks (`pnpm build`, `lint`, `typecheck`, the tests) only see variables listed in `turbo.json` (`globalPassThroughEnv`, plus the build task's `env`). Every variable `check-env` validates must also be in the build task's `env`, which makes it part of the build's cache key (turbo stores only a hash of the value): otherwise a build cached locally or in Vercel's Remote Cache would be replayed without `check-env` running after that variable changed. `pnpm dev` runs in loose mode, so any exported variable reaches the dev servers.
- Integration vars are required **only when that integration is enabled**. Each adapter's `config.ts` validates its own group, and `isConfigured()` reports the result to the admin UI.
- `.env` files are git-ignored. Only [`.env.example`](../.env.example) is committed. Production values live only in the hosting provider's encrypted env store.
- Generate random secrets with `openssl rand -base64 32` (or `-base64 48` where noted).

Legend: **S** = storefront, **A** = admin, **J** = jobs/cron (runs in storefront), **CI** = build pipeline only.
Required: ● always · ◐ production/staging only · ○ only if the integration is enabled.

## Core

| Variable | Apps | Kind | Req. | Purpose |
|---|---|---|---|---|
| `APP_ENV` | S A | config | ● | `development` · `test` (CI) · `staging` · `production`. No default, so a deploy can't silently run as development. Drives safety checks (deployment secrets and https in staging/production; later: rejects Mailpit and sandbox keys in production). |
| `NEXT_PUBLIC_SITE_URL` | S A | public | ● | Storefront origin, e.g. `https://novyra.pk`. Canonical URLs, email links. |
| `ADMIN_URL` | S A | config | ● | Admin origin, e.g. `https://admin.novyra.pk`. Trusted origin for the admin auth instance. |
| `DATABASE_URL` | S A J | secret | ● | **Pooled** PostgreSQL URL used at runtime (`sslmode=require` in hosted envs). Runtime DB role: DML only. |
| `DIRECT_DATABASE_URL` | dev CI | secret | ● | **Direct** (non-pooled) URL used by the Prisma CLI. `prisma.config.ts` requires it for every Prisma command, including `prisma generate` during app builds. Migrator DB role for `migrate deploy`. |
| `SHADOW_DATABASE_URL` | dev CI | secret | ○ | Disposable DB for `migrate dev` / drift checks. Never production. |
| `TEST_DATABASE_URL` | dev CI | secret | ○ | Disposable DB for the integrity tests: `pnpm db:test:prepare` migrates it, `pnpm db:test` runs against it. Never production. |
| `DATA_ENCRYPTION_KEY` | S A J | secret | ◐ | 32 random bytes, canonical base64 (surrounding whitespace is ignored): generate it with `openssl rand -base64 32`. Free text that isn't base64 and low-variety placeholders (`AAAA…`) are rejected, but a passphrase typed in the base64 alphabet can't be told apart from a key, so never invent one. AES-256-GCM for field-level encryption (refund payout details). Versioned (`v1:`) for rotation. Optional in development and test. |
| `INTERNAL_API_SECRET` | S A | secret | ◐ | HMAC key for admin → storefront `/api/internal/dispatch`, ≥ 32 characters. `openssl rand -base64 48`. |
| `CRON_SECRET` | S A | secret | ◐ | Bearer token Vercel Cron sends to `/api/cron/*` (storefront), ≥ 32 characters. Both apps validate the shared Core set, so set it on both projects. |
| `LOG_LEVEL` | S A J | config | | `info` by default. |

## Authentication

| Variable | Apps | Kind | Req. | Purpose |
|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | S | secret | ● | Signs/encrypts storefront session cookies and tokens. ≥ 32 bytes. Rotating it signs every customer out. |
| `ADMIN_BETTER_AUTH_SECRET` | A | secret | ● | **Different** secret for the admin instance (storefront cookies can never validate on admin). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | S | secret | ○ | Optional "Continue with Google". |

## Abuse protection

| Variable | Apps | Kind | Req. | Purpose |
|---|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | S A | secret | ◐ | Rate limiting. Dev falls back to an in-process limiter. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | S | public | ◐ | Cloudflare Turnstile widget. |
| `TURNSTILE_SECRET_KEY` | S | secret | ◐ | Server-side token verification. |

## Media

| Variable | Apps | Kind | Req. | Purpose |
|---|---|---|---|---|
| `MEDIA_PROVIDER` | S A | config | ● | `cloudinary` (default) or `s3`. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | S A | secret | ○ | Signed uploads, private delivery, admin operations. |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | S A | public | ○ | Builds image URLs in the browser (cloud name is public in every image URL anyway). |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET_PUBLIC` / `S3_BUCKET_PRIVATE` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S A | secret | ○ | S3-compatible alternative (e.g. Cloudflare R2). |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | S A | public | ○ | Public CDN base for the S3 adapter. |

## Email and messaging

| Variable | Apps | Kind | Req. | Purpose |
|---|---|---|---|---|
| `EMAIL_PROVIDER` | S A J | config | ● | `resend` (staging/production) or `smtp` (local Mailpit). |
| `EMAIL_FROM` | S A J | config | ● | e.g. `NOVYRA <orders@novyra.pk>` (domain must be verified with SPF/DKIM). |
| `EMAIL_REPLY_TO` | S A J | config | | e.g. `care@novyra.pk`. |
| `RESEND_API_KEY` | S A J | secret | ○ | Sending. |
| `RESEND_WEBHOOK_SECRET` | S | secret | ○ | Verifies delivery/bounce webhooks (Svix signature). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | S A J | secret | ○ | Local Mailpit (`localhost:1025`). Rejected in production. |
| `WHATSAPP_ACCESS_TOKEN` | J | secret | ○ | Meta WhatsApp Cloud API system-user token. |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID` | J | config | ○ | Sender identifiers. |
| `WHATSAPP_APP_SECRET` | S | secret | ○ | Verifies `X-Hub-Signature-256` on WhatsApp webhooks. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | S | secret | ○ | Webhook subscription handshake. |

## Payments

Used by the storefront (initiation, return URLs, webhooks, reconciliation cron) and the admin (refunds, manual verification).
Only providers you have registered **and** configured can be enabled in admin. `cod` and `bank_transfer` need no
variables (bank account details are public instructions entered in admin).

| Variable | Kind | Req. | Purpose |
|---|---|---|---|
| `JAZZCASH_MERCHANT_ID` / `JAZZCASH_PASSWORD` / `JAZZCASH_INTEGRITY_SALT` | secret | ○ | JazzCash merchant credentials + hash salt. |
| `JAZZCASH_ENVIRONMENT` | config | ○ | `sandbox` · `production`. Production rejects `sandbox`. |
| `EASYPAISA_STORE_ID` / `EASYPAISA_HASH_KEY` | secret | ○ | Easypaisa merchant credentials. |
| `EASYPAISA_ENVIRONMENT` | config | ○ | `sandbox` · `production`. |
| `PAYFAST_MERCHANT_ID` / `PAYFAST_SECURED_KEY` | secret | ○ | PayFast (Pakistan) merchant credentials. |
| `PAYFAST_ENVIRONMENT` | config | ○ | `sandbox` · `production`. |
| `SAFEPAY_API_KEY` / `SAFEPAY_SECRET_KEY` / `SAFEPAY_WEBHOOK_SECRET` | secret | ○ | Safepay credentials. |
| `SAFEPAY_ENVIRONMENT` | config | ○ | `sandbox` · `production`. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | secret | ○ | Future international processor (needs an entity in a supported country). |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | ○ | Same. |

The exact credential set per gateway is confirmed from its merchant integration kit during Phase 5. Names above are
NOVYRA's own and stay stable.

## Shipping

Used by the admin (booking, labels, cancellation) and the storefront (tracking webhooks and the `shipments-sync` cron).

| Variable | Kind | Req. | Purpose |
|---|---|---|---|
| `TCS_API_BASE_URL` / `TCS_CLIENT_ID` / `TCS_CLIENT_SECRET` / `TCS_ACCOUNT_NUMBER` | secret | ○ | TCS API (credential set confirmed at onboarding). |
| `LEOPARDS_API_KEY` / `LEOPARDS_API_PASSWORD` | secret | ○ | Leopards Courier API. |
| `POSTEX_API_TOKEN` / `POSTEX_PICKUP_ADDRESS_CODE` | secret | ○ | PostEx API. |
| `<COURIER>_ENVIRONMENT` | config | ○ | `sandbox` · `production` where the courier offers a test environment. |

The `manual` carrier needs nothing.

## Analytics and observability

| Variable | Apps | Kind | Req. | Purpose |
|---|---|---|---|---|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | S | public | ○ | GA4 browser tag (`G-XXXXXXX`). |
| `GA4_API_SECRET` | J | secret | ○ | GA4 Measurement Protocol (server-side purchase). |
| `NEXT_PUBLIC_GTM_ID` | S | public | ○ | Optional GTM container instead of direct gtag. |
| `NEXT_PUBLIC_META_PIXEL_ID` | S | public | ○ | Meta Pixel. |
| `META_CAPI_ACCESS_TOKEN` | J | secret | ○ | Meta Conversions API. |
| `META_CAPI_TEST_EVENT_CODE` | J | config | ○ | Staging only. Routes events to Meta's Test Events. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | S A | public-ish | ◐ | Error reporting (a DSN only allows sending events). |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | CI | secret | ◐ | Source-map upload during build. Never present at runtime. |
