import path from "node:path";

import { config } from "dotenv";

// Loads env files for the Prisma CLI and the integration tests, which run with packages/db as the
// working directory. A package-local `.env` wins over the workspace `novyra/.env`, and variables
// already set in the shell win over both (dotenv never overrides).
config({
  path: [path.join(import.meta.dirname, ".env"), path.join(import.meta.dirname, "../../.env")],
  quiet: true,
});
