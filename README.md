# NOVYRA: luxury jewellery e-commerce platform

Production architecture for NOVYRA's online store: a customer storefront, an operations admin, and a modular
backend for catalog, orders, inventory, payments, shipping, notifications and analytics, built for the Pakistani
market first (COD, bank transfer, local gateways and couriers) and international later.

> **Status: Phase 0 (foundations) complete in code; staging deploy waits on hosting accounts and domains.**
> The monorepo, database, shared backend kernel, seed, CI and two empty Next.js apps exist and are tested.
> **No UI has been built yet** (Phase 2). Decisions: [docs/08-implementation-plan.md](docs/08-implementation-plan.md#decisions).

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

## Getting started

Requires Node 24 LTS, pnpm 11 (`corepack enable` or `npm i -g pnpm@11`) and Docker.

```bash
git clone https://github.com/1sufyan/novyra && cd novyra
pnpm install
cp .env.example .env              # works as-is with docker compose
docker compose up -d              # PostgreSQL 17 (+ shadow and test databases) and Mailpit

pnpm db:migrate:deploy            # apply migrations
pnpm db:seed                      # permissions, roles, cities, methods, settings (idempotent)
pnpm dev                          # storefront http://localhost:3000 · admin http://localhost:3001
```

Every command reads the repository-root `.env`; variables exported in the shell take precedence.

| Command | What it does |
|---|---|
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` | Static checks across the monorepo (Turborepo) |
| `pnpm test` | Unit tests (no database) |
| `pnpm db:test:prepare && pnpm test:integration` | Migrates `TEST_DATABASE_URL`, then runs every database test |
| `pnpm build` | Production builds of both apps |
| `pnpm db:migrate:dev --name <change>` | Create a migration after editing `schema.prisma` |
| `pnpm db:studio` | Browse the local database |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above on every push, against a real PostgreSQL,
including a migration-drift check and seeding twice.

## What is tested

| Area | Proof |
|---|---|
| Schema and migrations | `prisma validate`; no drift between migrations, schema and a migrated database; applies to an empty database in CI |
| Database integrity (`packages/db/tests`) | 14 integrity tests (8 buyers for 3 units → exactly 3 succeed; coupon limits; refund caps; append-only ledgers) and 5 transaction tests (real deadlocks are retried and both sides commit) |
| Backend kernel (`packages/core`) | Unit: money arithmetic and allocation, AES-GCM field encryption with key rotation, HMAC, error exposure rules, SSRF-safe HTTP client, log redaction. Integration: idempotency under concurrency, outbox delivering each event exactly once across concurrent workers, health, seed idempotency |
| Environment | Invalid or missing variables stop the apps from booting, without echoing values |
| Apps | Security headers and CSP on every response; per-request CSP nonce on every admin script; request ids that clients can't forge into logs; `/api/health` returns 503 when background work is failing |

## Principles

1. **Business rules live in `packages/core`**, never in UI components or route handlers.
2. **The server decides money.** Prices, discounts, shipping and totals are always recomputed on the server.
3. **Every external service sits behind an interface**, and is unavailable (not faked) until it has real credentials.
4. **Money and stock move only through idempotent, transactional code paths**, backed by database constraints.
5. **Secrets never reach the browser.** Only allowlisted `NEXT_PUBLIC_*` identifiers do.
