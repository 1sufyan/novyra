# 00 · Technology stack and version policy

Versions were checked against the npm registry on **2026-10-13**, along with peer-dependency compatibility.
`packages/db` is installed and tested with the versions marked ✅. The rest get pinned
exactly (no `^`) when their package is scaffolded in Phase 0–2.

## Runtime and tooling

| Concern | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node.js LTS "Krypton" | **24.x** (24.21.0) | Node 26 is still "Current" (not LTS) until late Oct 2026. Upgrade once it reaches LTS. |
| Package manager | pnpm (workspaces) | **11.28.2** ✅ | pnpm 12 is a new Rust rewrite released 2026-08-26, too new for production. Revisit in 2027. |
| Monorepo tasks | Turborepo | 2.11.7 | Caches lint/typecheck/test/build per package. |
| Language | TypeScript | **6.0.3** ✅ | **Not 7.x**: `typescript-eslint` (required by `eslint-config-next`) supports `>=4.8.4 <6.1.0`. Move to TS 7 once typescript-eslint supports it. |
| Lint / format | ESLint 10.12 + `eslint-config-next` 16.4.0 + `typescript-eslint` 8.71; Prettier 3.9 + `prettier-plugin-tailwindcss` 0.8 | | Import-boundary rules enforce the module layering (see 07). |

## Application

| Concern | Choice | Version | Why |
|---|---|---|---|
| Web framework | Next.js (App Router) | **16.4.0** | Server Components and Server Actions keep secrets and business logic on the server. `"use cache"` / `cacheTag` give a fast catalog, `proxy.ts` (Next 16's renamed middleware) handles cheap request gating, and `after()` handles post-response work. |
| UI runtime | React / React DOM | 19.3.0 | Required by Next 16. React Compiler (`babel-plugin-react-compiler` 1.0) enabled. |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) | 4.3.3 | CSS-first `@theme` tokens shared through `packages/ui`. |
| Motion | **Motion** (`motion`, formerly Framer Motion) | 14.1.1 | Same maintainers and API. `framer-motion` is now the legacy package name. Import from `motion/react`. |
| Internationalisation | `next-intl` | 4.14.9 | Storefront strings in message files from day one. English only at launch, so Urdu (right-to-left) can be added later without a rebuild (decision D5). Peer-compatible with Next 16. |
| Validation | Zod | 4.6.7 | One schema validates the form on the client and the command on the server. |
| ORM | Prisma ORM + `@prisma/adapter-pg` + `pg` | **7.10.0** ✅ / 8.23.1 | **Not 8.x**: the `prisma` CLI's `latest` npm tag points at `8.0.0-rc.22` (a release candidate), while `@prisma/client`'s `latest` is 7.10.0. Pin both to 7.10.0. Prisma 7 uses the TS query compiler + driver adapter (no Rust query engine) and reads the connection URL from `prisma.config.ts`. |
| Database | PostgreSQL | **17 or 18** (managed) | Schema verified on 16.15 locally; uses nothing newer than PG 13 (`pg_trgm` as a trusted extension). |
| Auth | Better Auth | 1.7.7 | Server-side DB sessions, signed httpOnly cookies, built-in CSRF/origin checks, rate limiting, TOTP 2FA plugin, Prisma adapter. Peer-compatible with Next 16 / Prisma 7. Auth.js v5 never left beta and NextAuth v4 is legacy. |
| Password hashing | Argon2id via `@node-rs/argon2` | 2.2.2 | Prebuilt native binaries (no node-gyp). Plugged into Better Auth's `password.hash/verify`. |
| Env validation | `@t3-oss/env-nextjs` + Zod | 0.13.11 | Hard server/client split; the build fails on missing or invalid vars. |
| Rate limiting / cache | Upstash Redis + `@upstash/ratelimit` | 1.39.0 / 2.2.0 | HTTP-based, works in serverless and in the Node proxy. |
| Bot protection | Cloudflare Turnstile (`@marsidev/react-turnstile`) | 1.6.2 | Sign-up, password reset, COD checkout, newsletter, reviews. |
| Media | Cloudinary (`cloudinary` SDK) behind `MediaStorage` | 2.11.0 | Signed direct uploads, on-the-fly AVIF/WebP and crops for jewellery photography. S3/R2 adapter documented as the alternative. |
| Email | Resend + React Email (`resend`, `@react-email/components`) behind `NotificationSender` | 6.32.1 / 1.0.12 | Mailpit over SMTP for local development (the real SMTP adapter, not a mock). |
| Sanitisation | `sanitize-html` | 2.18.0 | Admin-authored rich text, sanitised on write. |
| Phone numbers | `libphonenumber-js` | 1.13.15 | E.164 normalisation (`+92…`). |
| Logging | pino | 10.4.0 | JSON logs with redaction paths for PII and secrets. |
| Errors / tracing | Sentry (`@sentry/nextjs`) | 11.7.0 | Supports Next 16 and Node 24. |
| Analytics | `@next/third-parties` (GA4 / GTM) + Meta Pixel + GA4 Measurement Protocol + Meta Conversions API | 16.4.0 | Browser and server events de-duplicated by a shared `event_id`. |
| Hosting helpers | `@vercel/functions` | 3.9.11 | `waitUntil`, DB pool lifecycle on Fluid compute. |

## Testing

| Layer | Tool | Version |
|---|---|---|
| Unit / service | Vitest | 5.0.4 (with Vite 8.3) |
| Database integration | `node:test` via `tsx` against a real PostgreSQL | tsx 4.23.15 ✅ |
| Component | Testing Library React | 16.3.3 |
| End-to-end | Playwright | 1.64.0 |

## Version policy

1. **Exact pins** in every `package.json`. `pnpm-lock.yaml` is committed. Renovate opens grouped weekly PRs.
2. **No release candidates or canaries** in production dependencies (that's why Prisma is on 7.10, not 8.0-rc).
3. **Wait two weeks after a new minor** of a framework-level package (Next, React, Prisma, Better Auth) unless it fixes a security issue.
4. **Lifecycle scripts are deny-by-default.** `pnpm-workspace.yaml` → `allowBuilds` lists the only packages allowed to run install scripts (supply-chain hardening).
5. Security advisories (`pnpm audit`, GitHub Dependabot alerts) block the release pipeline at "high" or above.
