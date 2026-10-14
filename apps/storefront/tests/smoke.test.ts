/**
 * Smoke tests against the built storefront (`pnpm build` first): `pnpm test:smoke`.
 * DATABASE_URL must point to a migrated database (the root .env or the shell).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { startApp, type StartedApp } from "@novyra/config/testing/next-server";

const cwd = new URL("..", import.meta.url).pathname;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const local = {
  APP_ENV: "test",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  ADMIN_URL: "http://localhost:3001",
};

describe("storefront", () => {
  let app: StartedApp;
  before(async () => {
    app = await startApp({ cwd, env: local });
    assert.equal(app.exitCode, undefined, app.output);
  });
  after(() => app.stop());

  test("sends the security headers and the allowlist CSP", async () => {
    const response = await fetch(app.url);
    assert.equal(response.status, 200);
    const headers = response.headers;
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
    assert.ok(headers.get("referrer-policy"));
    assert.ok(headers.get("permissions-policy"));
    assert.equal(headers.get("x-powered-by"), null);
    const csp = headers.get("content-security-policy") ?? "";
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) {
      assert.ok(csp.includes(directive), `CSP has ${directive}: ${csp}`);
    }
  });

  test("keeps a well-formed request id and replaces anything else", async () => {
    const id = randomUUID();
    const kept = await fetch(app.url, { headers: { "x-request-id": id } });
    assert.equal(kept.headers.get("x-request-id"), id);
    const replaced = await fetch(app.url, { headers: { "x-request-id": "attacker-chosen text" } });
    const generated = replaced.headers.get("x-request-id") ?? "";
    assert.match(generated, UUID);
    assert.notEqual(generated, "attacker-chosen text");
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
    const app = await startApp({
      cwd,
      env: { ...local, DATABASE_URL: "postgresql://nobody:wrong@127.0.0.1:1/none" },
    });
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
});
