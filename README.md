# NOVYRA: luxury jewellery e-commerce platform

Production architecture for NOVYRA's online store: a customer storefront, an operations admin, and a modular
backend for catalog, orders, inventory, payments, shipping, notifications and analytics, built for the Pakistani
market first (COD, bank transfer, local gateways and couriers) and international later.

> **Status: Phase 0 (foundations) in progress.** This repository holds the architecture and a working,
> tested database package. **No UI has been built yet.** The key product decisions are recorded in
> [docs/08-implementation-plan.md](docs/08-implementation-plan.md#decisions).

## Documents

| # | Document | Contents |
|---|---|---|
| 00 | [Tech stack](docs/00-tech-stack.md) | Verified versions, compatibility constraints, version policy |
| 01 | [Architecture](docs/01-architecture.md) | Modular monolith, two apps, service boundaries, request flows, background jobs, caching, deployment, scaling |
| 02 | [Database](docs/02-database.md) | Conventions, ER diagrams, table catalogue, constraints, indexes, transactions and concurrency, migrations, data lifecycle |
| 03 | [Security](docs/03-security.md) | Threat model, authentication, sessions, RBAC matrix, validation, rate limits, CSRF, XSS, injection, webhooks, idempotency, headers/CSP, secrets |
| 04 | [Payments](docs/04-payments.md) | Provider abstraction, contract, state machine, COD / bank transfer / gateway flows, refunds, reconciliation |
| 05 | [Shipping](docs/05-shipping.md) | Courier abstraction, rates, city mapping, idempotent booking, tracking, RTO, reverse logistics |
| 06 | [Integrations](docs/06-integrations.md) | Notifications (email, WhatsApp, SMS), media storage, analytics (GA4, Meta, server-side), platform services |
| 07 | [Folder structure](docs/07-folder-structure.md) | Monorepo layout and dependency rules |
| 08 | [Implementation plan](docs/08-implementation-plan.md) | Phases, exit criteria, testing strategy, **decisions** (agreed and still open), accounts to request |
| 09 | [Environment](docs/09-environment.md) | Every env var: purpose, app, secret/public, when required |

## What exists and is verified

| Item | Verification |
|---|---|
| `packages/db/prisma/schema.prisma`: 58 models, 34 enums | `prisma validate` ✓ · `prisma format` ✓ |
| `migrations/…_init` + `migrations/…_integrity_constraints` | Applied to PostgreSQL 16 ✓ · `migrate diff` (DB ↔ schema and migrations ↔ schema): **no drift** ✓ · shadow-DB `migrate dev`: empty ✓ |
| `packages/db/tests/integrity.test.ts` | **14/14 pass**, stable over repeated runs. Covers concurrent stock reservation (8 buyers, 3 units → exactly 3 succeed), concurrent coupon redemption, outbox claiming with `SKIP LOCKED`, total arithmetic, refund caps, append-only ledgers. A negative control without the constraints migration fails 12/14. |
| Generated client + tests | `tsc --noEmit` with TypeScript 6.0.3 ✓ |
| Integration contracts in docs 04–06 | Type-checked under `strict` + `exactOptionalPropertyTypes` ✓ |

## Working with the database package

Requires Node 24 LTS, pnpm 11 and a PostgreSQL ≥ 13 you can create databases on.

```bash
git clone https://github.com/1sufyan/novyra && cd novyra
pnpm install
cp .env.example .env                      # set DIRECT_DATABASE_URL, SHADOW_DATABASE_URL, TEST_DATABASE_URL

pnpm db:validate                          # schema is valid
pnpm db:migrate:deploy                    # apply migrations to DIRECT_DATABASE_URL
pnpm db:generate                          # generate the Prisma client (git-ignored)
pnpm db:typecheck

# integrity tests run against a separate, disposable database:
pnpm db:test:prepare                      # apply migrations to TEST_DATABASE_URL
pnpm db:test
```

The db scripts read the repository's root `.env` (and `packages/db/.env` if present). Variables already exported in the shell take precedence.

## Principles

1. **Business rules live in `packages/core`**, never in UI components or route handlers.
2. **The server decides money.** Prices, discounts, shipping and totals are always recomputed on the server.
3. **Every external service sits behind an interface**, and is unavailable (not faked) until it has real credentials.
4. **Money and stock move only through idempotent, transactional code paths**, backed by database constraints.
5. **Secrets never reach the browser.** Only allowlisted `NEXT_PUBLIC_*` identifiers do.
