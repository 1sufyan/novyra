/**
 * Smoke tests against the built admin (`pnpm build` first): `pnpm test:smoke`.
 * DATABASE_URL must point to a migrated database (the root .env or the shell).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { startApp, type StartedApp } from "@novyra/config/testing/next-server";

const cwd = new URL("..", import.meta.url).pathname;
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

  test("is private: noindex, no caching, same-origin opener", async () => {
    const response = await fetch(app.url);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  });

  test("/api/health answers 200", async () => {
    const response = await fetch(`${app.url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

describe("admin with an invalid environment", () => {
  test("refuses to start", async () => {
    const app = await startApp({ cwd, env: { ...local, ADMIN_URL: "not a url" } });
    await app.stop();
    assert.equal(app.exitCode, 1, app.output);
    assert.match(app.output, /ADMIN_URL/);
  });
});
