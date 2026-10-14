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
pnpm db:seed                      # generates the Prisma client, then seeds permissions, roles, cities,
                                  # methods and settings (idempotent)
pnpm dev                          # storefront http://localhost:3000 · admin http://localhost:3001
```

Every command reads the repository-root `.env`, and variables exported in the shell take precedence. Under
Turborepo's strict environment mode, `pnpm build` and the other turbo tasks see only the variables listed in
`turbo.json`; `pnpm dev` runs in loose mode and sees everything ([docs/09](docs/09-environment.md)).

| Command | What it does |
|---|---|
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` | Static checks across the monorepo (Turborepo) |
| `pnpm test` | Unit tests (no database) |
| `pnpm db:test:prepare && pnpm test:integration` | Migrates `TEST_DATABASE_URL`, then runs every database test |
| `pnpm build` | Validates the environment, then builds both apps (generates the Prisma client first) |
| `pnpm test:smoke` | Starts the built apps and checks headers, CSP nonces, request ids, health and env refusal |
| `pnpm db:generate` | Regenerate the Prisma client (git-ignored) after editing `schema.prisma` |
| `pnpm db:migrate:dev --name <change>` | Create a migration after editing `schema.prisma` |
| `pnpm db:studio` | Browse the local database |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above on every push, against a real PostgreSQL,
including a migration-drift check, seeding twice and the smoke tests.

## What is tested

| Area | Proof |
|---|---|
| Schema and migrations | `prisma validate`; no drift between migrations, schema and a migrated database; applies to an empty database in CI |
| Database (`packages/db/tests`) | 14 integrity tests (8 buyers for 3 units → exactly 3 succeed; coupon limits; refund caps; append-only ledgers), 6 transaction tests (real deadlocks and SERIALIZABLE commit conflicts are retried until both sides commit) and a client test (a query to a database that went silent fails instead of hanging) |
| Backend kernel (`packages/core`) | Unit: money arithmetic and allocation, AES-GCM field encryption (key rotation, full-length tags, canonical keys), HMAC, error exposure rules, SSRF-safe HTTP client (fetch-style redirects, no credentials across origins), log redaction (nested keys, messages and interpolation values). Integration: idempotency under concurrency, lock renewal while work runs, and takeover (a superseded attempt can't complete or release the key), outbox (concurrent workers never share an event, a slow run doesn't hold or duplicate events it hasn't started, abandoned events count as attempts and go DEAD when out of attempts), health (including a database that never answers), seed idempotency |
| Environment | `check-env` refuses to build or start with invalid or missing variables, naming each problem without echoing values; those variables are part of the build's cache key, so a cached build can't skip the check (unit tests plus smoke tests) |
| Apps (`pnpm test:smoke`) | Both apps: security headers and CSP on pages, API routes and 404s; an incoming request id is kept only if it is a well-formed UUID, otherwise replaced; `/api/health` is 200 when healthy and 503 when the database is unreachable. Admin: a fresh nonce on every script per request, `noindex`, `no-store`. Storefront: started without `check-env`, an invalid environment makes every request answer 500 instead of serving |

## Principles

1. **Business rules live in `packages/core`**, never in UI components or route handlers.
2. **The server decides money.** Prices, discounts, shipping and totals are always recomputed on the server.
3. **Every external service sits behind an interface**, and is unavailable (not faked) until it has real credentials.
4. **Money and stock move only through idempotent, transactional code paths**, backed by database constraints.
5. **Secrets never reach the browser.** Only allowlisted `NEXT_PUBLIC_*` identifiers do.
