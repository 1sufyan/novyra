# 07 · Folder structure

✅ = exists in this repository now. Everything else is created in the phase noted in [08-implementation-plan.md](08-implementation-plan.md).

```
novyra/
├── package.json                      ✅ workspace root, scripts, engines (Node 24), packageManager (pnpm 11)
├── pnpm-workspace.yaml               ✅ workspaces + allowBuilds (install-script allowlist)
├── turbo.json                           task graph: lint → typecheck → test → build
├── .env.example                      ✅ every env var, documented (see 09)
├── .gitignore                        ✅
├── docker-compose.yml                   local Postgres 17 + Mailpit (+ optional Redis)
├── .github/workflows/
│   ├── ci.yml                           lint · typecheck · unit · db integration (Postgres service) · migration drift · build
│   └── release.yml                      migrate:deploy (migrator role) → deploy apps
├── docs/                             ✅ architecture (this folder)
│
├── apps/
│   ├── storefront/                      novyra.pk — Next.js 16
│   │   ├── next.config.ts               headers/CSP, images loader, typedRoutes, reactCompiler, taint
│   │   ├── messages/en.json             every storefront string (next-intl). Urdu later = messages/ur.json
│   │   ├── src/
│   │   │   ├── proxy.ts                 request id · cheap auth redirects (NOT a security boundary)
│   │   │   ├── instrumentation.ts       Sentry / OpenTelemetry
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
│   │   │   │       └── health/route.ts
│   │   │   ├── features/                feature slices: UI + server actions + queries, per domain
│   │   │   │   ├── catalog/             product gallery, variant picker, listing filters
│   │   │   │   ├── cart/                actions.ts (add/update/remove/merge), cart drawer
│   │   │   │   ├── checkout/            actions.ts (placeOrder), steps, PaymentNextAction
│   │   │   │   ├── account/ · reviews/ · wishlist/ · newsletter/ · consent/
│   │   │   ├── components/              site chrome: header, mega-menu, footer, search overlay
│   │   │   └── lib/                     defineAction(), auth-client, cart cookie, seo helpers, image loader
│   │   └── tests/e2e/                   Playwright: browse → cart → COD checkout, bank transfer, account
│   │
│   └── admin/                           admin.novyra.pk — Next.js 16
│       └── src/
│           ├── proxy.ts                 request id · nonce CSP · auth redirect
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
│   │   │   ├── client.ts                PrismaClient + @prisma/adapter-pg, singleton per process
│   │   │   ├── transaction.ts           withTransaction(): timeout, retry on 40001/40P01
│   │   │   ├── seed/                    permissions, roles, cities, zones, methods, settings
│   │   │   └── generated/prisma/        (git-ignored) generated client
│   │   └── tests/integrity.test.ts   ✅ DB invariants incl. concurrency
│   │
│   ├── core/                            @novyra/core — the backend (import "server-only")
│   │   └── src/
│   │       ├── shared/                  money.ts · errors.ts · result.ts · ids.ts · crypto.ts (AES-GCM, HMAC)
│   │       │                            idempotency.ts · outbox.ts · rate-limit.ts · turnstile.ts · http.ts (allowlisted fetch)
│   │       │                            logger.ts · request-context.ts · types.ts (Money, InboundHttpRequest)
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
│   │       ├── customers/ · reviews/ · wishlist/ · returns/ · refunds/ · coupons/ · newsletter/ · settings/ · audit/
│   │       └── jobs/                    dispatcher.ts · handlers/ · scheduled/ (expire-reservations, reconcile-payments, sync-shipments, cleanup, …)
│   │
│   ├── auth/                            @novyra/auth (import "server-only")
│   │   └── src/
│   │       ├── storefront.ts · admin.ts Better Auth instances
│   │       ├── password.ts              Argon2id hash/verify
│   │       ├── permissions.ts           permission catalogue (source of truth) + role templates
│   │       └── guards.ts                requireUser · requireStaff · requirePermission · requireFreshSession
│   │
│   ├── validation/                      @novyra/validation: isomorphic Zod schemas (address, checkout, product, coupon, review, …)
│   ├── env/                             @novyra/env: server.ts (server-only) · client.ts (NEXT_PUBLIC_ allowlist)
│   ├── ui/                              @novyra/ui: design tokens (Tailwind v4 @theme), primitives, motion presets
│   ├── emails/                          @novyra/emails: React Email templates + preview server
│   ├── analytics/                       @novyra/analytics: track(), consent store, GA4 + Meta Pixel destinations
│   └── config/                          shared tsconfig, eslint (incl. import-boundary rules), prettier
```

## Dependency rules

| Package | May import | Must not import |
|---|---|---|
| `apps/*` | `core`, `auth`, `validation`, `env`, `ui`, `analytics` | `db` (data access only through `core`) |
| `core` | `db`, `auth` (types/guards), `validation`, `env/server`, `emails` | `apps/*`, `ui`, `analytics` |
| `auth` | `db`, `env/server` | `core`, `apps/*` |
| `ui`, `validation`, `analytics` | each other's public types only | anything server-only |
| `core/<module>` | other modules' `index.ts` only | other modules' internals |

Enforced by ESLint `no-restricted-imports` patterns plus `server-only`. CI fails on a violation.

## Naming conventions

- Files `kebab-case.ts`, React components `PascalCase.tsx`, one component per file in `ui`.
- Server Actions live in `features/<slice>/actions.ts` and are always created with `defineAction()`.
- DTOs end in `DTO` (`ProductCardDTO`), commands in `Input` (`PlaceOrderInput`), events use dotted names (`order.placed`).
- Money in TypeScript is always a `Money`, never `number`.
