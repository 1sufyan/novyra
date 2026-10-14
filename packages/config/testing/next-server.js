// Starts a built Next.js app for smoke tests (`pnpm test:smoke`), plus shared assertions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

/** A port that was free a moment ago. */
export async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * Runs the app in `cwd` with `env` merged over the current environment: through its `start` script
 * (check-env, then next start), or with `checkEnv: false` through `next start` alone, to exercise
 * the runtime re-check. Resolves once the server answers /api/health, or once the process exits
 * (check `exitCode`).
 */
export async function startApp({ cwd, env = {}, checkEnv = true, timeoutMs = 30_000 }) {
  const port = String(await freePort());
  const pnpm = process.env.npm_execpath;
  const pnpmArgs = checkEnv
    ? ["start", "--port", port]
    : ["exec", "with-root-env", "next", "start", "--port", port];
  const [command, args] = pnpm ? [process.execPath, [pnpm, ...pnpmArgs]] : ["pnpm", pnpmArgs];
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so stop() also ends the next-server process the script starts.
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));

  const app = {
    url: `http://127.0.0.1:${port}`,
    exitCode: undefined,
    get output() {
      return output;
    },
    async stop() {
      if (app.exitCode !== undefined) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
      await exited;
    },
  };
  exited.then((code) => (app.exitCode = code));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (app.exitCode !== undefined) return app;
    try {
      await fetch(`${app.url}/api/health`, { signal: AbortSignal.timeout(2_000) });
      return app;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  await app.stop();
  throw new Error(`App in ${cwd} did not start within ${timeoutMs} ms:\n${output}`);
}

/** The headers both apps send on every response (docs/03-security.md §12). */
export function assertSecurityHeaders(response, { coop }) {
  const headers = response.headers;
  const where = `${response.url} (${response.status})`;
  assert.equal(headers.get("x-content-type-options"), "nosniff", where);
  assert.equal(headers.get("x-frame-options"), "DENY", where);
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin", where);
  assert.match(headers.get("permissions-policy") ?? "", /camera=\(\)/, where);
  assert.equal(headers.get("cross-origin-opener-policy"), coop, where);
  assert.equal(headers.get("cross-origin-resource-policy"), "same-site", where);
  assert.match(headers.get("strict-transport-security") ?? "", /max-age=\d+/, where);
  assert.equal(headers.get("x-powered-by"), null, where);
  const csp = headers.get("content-security-policy") ?? "";
  for (const directive of [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ]) {
    assert.ok(csp.includes(directive), `${where}: CSP has ${directive}: ${csp}`);
  }
  assert.ok(!csp.includes("'unsafe-eval'"), `${where}: no 'unsafe-eval' in production: ${csp}`);
}

/** A well-formed incoming request id is kept; anything else is replaced by a fresh UUID. */
export async function assertRequestIds(url) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const id = randomUUID();
  const kept = await fetch(url, { headers: { "x-request-id": id } });
  assert.equal(kept.headers.get("x-request-id"), id);
  for (const forged of ["attacker-chosen text", `${id}x`, ""]) {
    const response = await fetch(url, { headers: { "x-request-id": forged } });
    const generated = response.headers.get("x-request-id") ?? "";
    assert.match(generated, UUID);
    assert.notEqual(generated, forged);
  }
}
