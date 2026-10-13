// Runs once when a server instance starts: refuse to boot with an invalid environment.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("@novyra/env/server");
    getServerEnv();
  }
}
