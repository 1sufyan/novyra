// Runs once when a server instance starts. `check-env` already refused to build or start with an
// invalid environment; this re-checks the runtime environment (e.g. a serverless instance), and a
// failure here makes every request answer 500 rather than run misconfigured.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("@novyra/env/server");
    getServerEnv();
  }
}
