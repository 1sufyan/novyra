/**
 * Smoke tests against the built admin (`pnpm build` first): `pnpm test:smoke`.
 * DATABASE_URL must point to a migrated database (the root .env or the shell).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertRequestIds,
  assertSecurityHeaders,
  runScript,
  startApp,
  type StartedApp,
} from "@novyra/config/testing/next-server";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const local = {
  APP_ENV: "test",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  ADMIN_URL: "http://localhost:3001",
};

function nonceOf(csp: string): string {
  const match = /'nonce-([^']+)'/.exec(csp);
  assert.ok(match, `CSP carries a nonce: ${csp}`);
  return match[1]!;
}

describe("admin", () => {
  let app: StartedApp;
  before(async () => {
    app = await startApp({ cwd, env: local });
    assert.equal(app.exitCode, undefined, app.output);
  });
  after(() => app.stop());

  test("every script carries the per-request nonce, and the nonce changes per request", async () => {
    const response = await fetch(app.url);
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("'strict-dynamic'"), csp);
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), `no inline scripts allowed: ${csp}`);
    const nonce = nonceOf(csp);

    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    assert.ok(scripts.length > 0, "the page has scripts");
    for (const tag of scripts) assert.ok(tag.includes(`nonce="${nonce}"`), `script without nonce: ${tag}`);

    const second = await fetch(app.url);
    assert.notEqual(nonceOf(second.headers.get("content-security-policy") ?? ""), nonce);
  });

  test("sends the security headers on pages, API routes and 404s, and is private", async () => {
    for (const path of ["/", "/api/health", "/no-such-page"]) {
      const response = await fetch(`${app.url}${path}`);
      assertSecurityHeaders(response, { coop: "same-origin" });
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path);
    }
    const page = await fetch(app.url);
    assert.equal(page.headers.get("cache-control"), "private, no-store");
  });

  test("keeps a well-formed request id and replaces anything else", async () => {
    await assertRequestIds(app.url);
  });

  test("/api/health answers 200", async () => {
    const response = await fetch(`${app.url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

describe("admin without its database", () => {
  test("/api/health answers 503", async () => {
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

describe("admin with an invalid environment", () => {
  const invalid = { ...local, ADMIN_URL: "not a url" };

  test("refuses to start", async () => {
    const app = await startApp({ cwd, env: invalid });
    try {
      // startApp returns when the process exits or the server answers: a refused start exits.
      assert.equal(app.exitCode, 1, `the server started instead of being refused:\n${app.output}`);
    } finally {
      await app.stop();
    }
    assert.match(app.output, /ADMIN_URL/);
    assert.doesNotMatch(app.output, /Ready in/);
  });

  test("refuses to build", async () => {
    const result = await runScript({ cwd, script: "build", env: invalid, timeoutMs: 20_000 });
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /ADMIN_URL/);
    assert.doesNotMatch(result.output, /Creating an optimized production build/);
  });
});
