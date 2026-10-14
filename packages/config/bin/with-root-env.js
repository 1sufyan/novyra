#!/usr/bin/env node
// Runs a command with the repository-root .env loaded, e.g. `with-root-env next build`.
// Variables already set in the environment win over the file. Without a .env (CI, Vercel) the
// command runs with the environment as-is.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";

const envFile = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: with-root-env <command> [...args]");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
const forwarded = ["SIGINT", "SIGTERM"];
for (const signal of forwarded) process.on(signal, () => child.kill(signal));

child.on("error", (error) => {
  console.error(`with-root-env: cannot run ${command}: ${error.message}`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  if (!signal) process.exit(code ?? 1);
  // Report the child's death the way a shell does, so an interrupted build never reads as success.
  // The forwarding handlers would swallow the re-raised signal, so remove them first.
  for (const name of forwarded) process.removeAllListeners(name);
  process.exitCode = 128 + (constants.signals[signal] ?? 0);
  process.kill(process.pid, signal);
});
