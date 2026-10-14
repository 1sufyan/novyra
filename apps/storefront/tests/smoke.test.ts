/**
 * Smoke tests against the built storefront (`pnpm build` first): `pnpm test:smoke`.
 * DATABASE_URL must point to a migrated database (the root .env or the shell).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertRequestIds,
  assertSecurityHeaders,
  startApp,
  type StartedApp,
} from "@novyra/config/testing/next-server";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const local = {
  APP_ENV: "test",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  ADMIN_URL: "http://localhost:3001",
};
const unreachableDatabase = "postgresql://nobody:wrong@127.0.0.1:1/none";

describe("storefront", () => {
  let app: StartedApp;
  before(async () => {
    app = await startApp({ cwd, env: local });
    assert.equal(app.exitCode, undefined, app.output);
  });
  after(() => app.stop());

  test("sends the security headers and the allowlist CSP on pages, API routes and 404s", async () => {
    for (const path of ["/", "/api/health", "/no-such-page"]) {
      const response = await fetch(`${app.url}${path}`);
      assertSecurityHeaders(response, { coop: "same-origin-allow-popups" });
    }
    assert.equal((await fetch(`${app.url}/no-such-page`)).status, 404);
  });

  test("keeps a well-formed request id and replaces anything else", async () => {
    await assertRequestIds(app.url);
    await assertRequestIds(`${app.url}/api/health`);
  });

  test("/api/health answers 200 and is never cached", async () => {
    const response = await fetch(`${app.url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

describe("storefront without its database", () => {
  test("/api/health answers 503 and exposes only the status", async () => {
    const app = await startApp({ cwd, env: { ...local, DATABASE_URL: unreachableDatabase } });
    try {
      const response = await fetch(`${app.url}/api/health`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "degraded" });
    } finally {
      await app.stop();
    }
  });
});

describe("storefront with an invalid environment", () => {
  test("refuses to start and names the problems", async () => {
    const app = await startApp({ cwd, env: { ...local, APP_ENV: "production" } });
    await app.stop();
    assert.equal(app.exitCode, 1, app.output);
    assert.match(app.output, /Invalid environment configuration/);
    assert.match(app.output, /must use https:\/\/ when APP_ENV=production/);
  });

  test("started without check-env, the runtime re-check answers 500 instead of serving", async () => {
    const app = await startApp({ cwd, checkEnv: false, env: { ...local, ADMIN_URL: "not a url" } });
    try {
      assert.equal(app.exitCode, undefined, app.output);
      assert.equal((await fetch(`${app.url}/api/health`)).status, 500);
      assert.equal((await fetch(app.url)).status, 500);
    } finally {
      await app.stop();
    }
  });
});
