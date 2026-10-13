// Seeds reference data into DATABASE_URL. Safe to run repeatedly: `pnpm db:seed`.
import path from "node:path";

import { config } from "dotenv";

import { getPrisma } from "@novyra/db";

import { seedReferenceData } from "../src/seed/index.ts";

config({
  path: [path.join(import.meta.dirname, "../.env"), path.join(import.meta.dirname, "../../../.env")],
  quiet: true,
});

const prisma = getPrisma();
try {
  const summary = await seedReferenceData(prisma);
  console.log("Seed complete:", summary);
} finally {
  await prisma.$disconnect();
}
