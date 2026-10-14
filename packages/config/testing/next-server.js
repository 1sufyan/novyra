// Starts a built Next.js app through its own `start` script, for smoke tests (`pnpm test:smoke`).
import { spawn } from "node:child_process";
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
 * Runs `pnpm start --port <port>` in `cwd` with `env` merged over the current environment.
 * Resolves once the server answers /api/health, or once the process exits (check `exitCode`).
 */
export async function startApp({ cwd, env = {}, timeoutMs = 30_000 }) {
  const port = await freePort();
  const pnpm = process.env.npm_execpath;
  const [command, args] = pnpm
    ? [process.execPath, [pnpm, "start", "--port", String(port)]]
    : ["pnpm", ["start", "--port", String(port)]];
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
