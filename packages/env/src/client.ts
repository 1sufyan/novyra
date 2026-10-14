import { z } from "zod";

/**
 * Browser-safe environment. Only `NEXT_PUBLIC_*` identifiers that are public by nature belong here.
 * Each variable is referenced explicitly, because Next.js inlines only direct `process.env.X` reads.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function getClientEnv(): ClientEnv {
  return clientEnvSchema.parse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
}
