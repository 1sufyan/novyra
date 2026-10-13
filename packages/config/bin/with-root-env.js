#!/usr/bin/env node
// Runs a command with the repository-root .env loaded, e.g. `with-root-env next build`.
// Variables already set in the environment win over the file. Without a .env (CI, Vercel) the
// command runs with the environment as-is.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: with-root-env <command> [...args]");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
