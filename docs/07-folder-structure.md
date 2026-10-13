# 07 · Folder structure

✅ = exists in this repository now. Everything else is created in the phase noted in [08-implementation-plan.md](08-implementation-plan.md).

```
novyra/
├── package.json                      ✅ workspace root, scripts, engines (Node 24), packageManager (pnpm 11)
├── pnpm-workspace.yaml               ✅ workspaces + allowBuilds (install-script allowlist)
├── turbo.json                        ✅ task graph: generate → lint · typecheck · test · build
├── .env.example                      ✅ every env var, documented (see 09)
├── .gitignore · .nvmrc · .prettierrc.json · .prettierignore   ✅
├── renovate.json                     ✅ weekly grouped updates, two-week wait for framework minors
├── docker-compose.yml                ✅ local Postgres 17 + Mailpit
├── docker/postgres/init.sql          ✅ creates the shadow and test databases
├── .github/workflows/
│   ├── ci.yml                        ✅ format · schema · drift · lint · typecheck · unit · migrate · seed ×2 · integration · build
│   └── release.yml                      migrate:deploy (migrator role) → deploy apps
├── docs/                             ✅ architecture (this folder)
│
├── apps/
│   ├── storefront/                   ✅ novyra.pk — Next.js 16 (Phase 0: shell, placeholder page, health)
│   │   ├── next.config.ts            ✅ security headers + CSP, typedRoutes (later: images loader, reactCompiler, taint)
│   │   ├── messages/en.json             every storefront string (next-intl). Urdu later = messages/ur.json
│   │   ├── src/
│   │   │   ├── proxy.ts              ✅ request id (later: cheap auth redirects; NOT a security boundary)
│   │   │   ├── instrumentation.ts    ✅ refuses to boot with an invalid environment (later: Sentry / OpenTelemetry)
│   │   │   ├── i18n/request.ts          next-intl config (single `en` locale at launch)
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx · globals.css (imports @novyra/ui theme)
│   │   │   │   ├── (marketing)/         home, about, journal, boutique, care guide
│   │   │   │   ├── (shop)/
│   │   │   │   │   ├── shop/[[...category]]/page.tsx
│   │   │   │   │   ├── collections/[slug]/page.tsx
│   │   │   │   │   ├── products/[slug]/page.tsx
│   │   │   │   │   ├── search/page.tsx
│   │   │   │   │   └── cart/page.tsx
│   │   │   │   ├── checkout/
│   │   │   │   │   ├── page.tsx                         address → shipping → payment → review
│   │   │   │   │   ├── payment/[orderId]/page.tsx       NextAction renderer / "confirming…" poller
│   │   │   │   │   └── confirmation/[orderId]/page.tsx
│   │   │   │   ├── account/             orders, order detail + returns, addresses, wishlist, profile, security (sessions, 2FA)
│   │   │   │   ├── (auth)/              sign-in, sign-up, forgot-password, reset-password, verify-email
│   │   │   │   ├── track-order/         guest lookup (signed link or number + email/phone)
│   │   │   │   ├── legal/               privacy, terms, shipping, returns policies
│   │   │   │   ├── sitemap.ts · robots.ts · opengraph-image.tsx
│   │   │   │   └── api/
│   │   │   │       ├── auth/[...all]/route.ts
│   │   │   │       ├── webhooks/payments/[provider]/route.ts
│   │   │   │       ├── webhooks/shipping/[provider]/route.ts
│   │   │   │       ├── webhooks/notifications/[provider]/route.ts
│   │   │   │       ├── payments/[provider]/return/route.ts
│   │   │   │       ├── cron/[job]/route.ts
│   │   │   │       ├── internal/dispatch/route.ts      HMAC-signed, admin → storefront
│   │   │   │       └── health/route.ts     ✅ ok / degraded only
│   │   │   ├── features/                feature slices: UI + server actions + queries, per domain
│   │   │   │   ├── catalog/             product gallery, variant picker, listing filters
│   │   │   │   ├── cart/                actions.ts (add/update/remove/merge), cart drawer
│   │   │   │   ├── checkout/            actions.ts (placeOrder), steps, PaymentNextAction
│   │   │   │   ├── account/ · reviews/ · wishlist/ · newsletter/ · consent/
│   │   │   ├── components/              site chrome: header, mega-menu, footer, search overlay
│   │   │   └── lib/                     defineAction(), auth-client, cart cookie, seo helpers, image loader
│   │   └── tests/e2e/                   Playwright: browse → cart → COD checkout, bank transfer, account
│   │
│   └── admin/                        ✅ admin.novyra.pk — Next.js 16 (Phase 0: shell, placeholder page, health)
│       └── src/
│           ├── proxy.ts              ✅ request id · per-request nonce CSP · no-store (later: auth redirect)
│           ├── app/
│           │   ├── (auth)/              sign-in, 2FA challenge, 2FA enrolment, accept-invite
│           │   └── (dashboard)/
│           │       ├── page.tsx         KPIs, queues (COD to verify, transfers to verify, to ship, returns)
│           │       ├── orders/ · products/ · collections/ · categories/ · inventory/
│           │       ├── customers/ · payments/ · refunds/ · shipments/ · returns/
│           │       ├── reviews/ · coupons/ · newsletter/ · media/
│           │       ├── settings/        store, payments, shipping zones & rates, cities & courier mapping, notifications
│           │       ├── staff/           users, roles, permissions
│           │       └── audit/
│           ├── features/                same slice pattern; every action = defineAction({ permission })
│           └── lib/
│
├── packages/
│   ├── db/                           ✅ @novyra/db
│   │   ├── prisma.config.ts          ✅ datasource URLs (Prisma 7)
│   │   ├── prisma.test.config.ts     ✅ same, pointed at TEST_DATABASE_URL (db:test:prepare)
│   │   ├── load-env.ts               ✅ loads packages/db/.env, then the root .env
│   │   ├── prisma/
│   │   │   ├── schema.prisma         ✅ 58 models, 34 enums
│   │   │   └── migrations/           ✅ init + integrity_constraints
│   │   ├── src/
│   │   │   ├── index.ts              ✅ public entry: generated client + helpers
│   │   │   ├── client.ts             ✅ PrismaClient + @prisma/adapter-pg, singleton per process
│   │   │   ├── transaction.ts        ✅ withTransaction(): timeout, retry on 40001/40P01
│   │   │   └── generated/prisma/        (git-ignored) generated client
│   │   └── tests/                    ✅ integrity.test.ts (DB invariants incl. concurrency) · transaction.test.ts (real deadlocks)
│   │
│   ├── core/                         ✅ @novyra/core — the backend
│   │   ├── scripts/seed.ts           ✅ `pnpm db:seed`
│   │   └── src/
│   │       ├── shared/               ✅ money · errors · result · crypto (AES-GCM, HMAC) · idempotency · outbox
│   │       │                            http (allowlisted fetch) · logger (redaction) · request-context · health
│   │       │                            (later: rate-limit · turnstile · InboundHttpRequest type)
│   │       ├── platform/             ✅ checkPlatformHealth(): the health entry point the apps call
│   │       ├── settings/             ✅ Zod schema + default per setting key (decided values from 08)
│   │       ├── seed/                 ✅ idempotent reference data: permissions, roles, cities, zone, methods, settings
│   │       ├── catalog/                 index.ts (public API) · service.ts · queries.ts · dto.ts · sanitize.ts
│   │       ├── cart/
│   │       ├── checkout/                pricing.ts · place-order.ts
│   │       ├── orders/                  state-machine.ts · service.ts · timeline.ts
│   │       ├── inventory/               reserve/commit/release/adjust · low-stock
│   │       ├── payments/
│   │       │   ├── types.ts · registry.ts · service.ts · state-machine.ts
│   │       │   ├── testing/contract.ts  shared provider contract test suite
│   │       │   └── providers/
│   │       │       ├── cod/             (Phase 3)
│   │       │       ├── bank-transfer/   (Phase 3)
│   │       │       └── <gateway>/       (Phase 5, once credentials exist) index.ts · config.ts · signature.ts · mapping.ts · README.md · __fixtures__/
│   │       ├── shipping/
│   │       │   ├── types.ts · registry.ts · rates.ts · fulfilment.ts · tracking.ts
│   │       │   └── providers/
│   │       │       ├── manual/          (Phase 4)
│   │       │       └── <courier>/       (Phase 6)
│   │       ├── notifications/           types.ts · service.ts · dispatcher.ts · rules.ts · templates/ · senders/{resend,smtp,whatsapp-cloud}/
│   │       ├── media/                   types.ts · cloudinary/ · s3/
│   │       ├── analytics/               ga4-measurement-protocol.ts · meta-capi.ts · reports.ts (SQL KPIs)
│   │       ├── customers/ · reviews/ · wishlist/ · returns/ · refunds/ · coupons/ · newsletter/ · audit/
│   │       └── jobs/                    dispatcher.ts · handlers/ · scheduled/ (expire-reservations, reconcile-payments, sync-shipments, cleanup, …)
│   │
│   ├── auth/                         ✅ @novyra/auth (Phase 0: permissions only)
│   │   └── src/
│   │       ├── storefront.ts · admin.ts Better Auth instances
│   │       ├── password.ts              Argon2id hash/verify
│   │       ├── permissions.ts        ✅ permission catalogue (source of truth) + role templates
│   │       └── guards.ts                requireUser · requireStaff · requirePermission · requireFreshSession
│   │
│   ├── validation/                      @novyra/validation: isomorphic Zod schemas (address, checkout, product, coupon, review, …)
│   ├── env/                          ✅ @novyra/env: server.ts (validated, cached) · client.ts (NEXT_PUBLIC_ allowlist)
│   ├── ui/                              @novyra/ui: design tokens (Tailwind v4 @theme), primitives, motion presets
│   ├── emails/                          @novyra/emails: React Email templates + preview server
│   ├── analytics/                       @novyra/analytics: track(), consent store, GA4 + Meta Pixel destinations
│   └── config/                       ✅ tsconfig presets · ESLint presets (incl. import boundaries) · next/security-headers
│                                        · bin/with-root-env (runs a command with the root .env loaded)
```

## Dependency rules

| Package | May import | Must not import |
|---|---|---|
| `apps/*` | `core`, `auth`, `validation`, `env`, `ui`, `analytics` | `db` (data access only through `core`) |
| `core` | `db`, `auth` (types/guards), `validation`, `env/server`, `emails` | `apps/*`, `ui`, `analytics` |
| `auth` | `db`, `env/server` | `core`, `apps/*` |
| `ui`, `validation`, `analytics` | each other's public types only | anything server-only |
| `core/<module>` | other modules' `index.ts` only | other modules' internals |

Enforced today by package `exports` maps (deep imports into another package's `src/` don't resolve), ESLint `no-restricted-imports` in the apps (no `@novyra/db`), and `server-only` on app-facing server entry points. Module-to-module rules inside `core` get an ESLint rule when the first domain modules land (Phase 2). CI fails on a violation.

## Naming conventions

- Files `kebab-case.ts`, React components `PascalCase.tsx`, one component per file in `ui`.
- Server Actions live in `features/<slice>/actions.ts` and are always created with `defineAction()`.
- DTOs end in `DTO` (`ProductCardDTO`), commands in `Input` (`PlaceOrderInput`), events use dotted names (`order.placed`).
- Money in TypeScript is always a `Money`, never `number`.
