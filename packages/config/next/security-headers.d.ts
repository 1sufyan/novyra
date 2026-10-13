export function securityHeaders(options: {
  coop: "same-origin" | "same-origin-allow-popups";
  contentSecurityPolicy?: string;
}): { key: string; value: string }[];

export function buildCsp(directives: Record<string, string[]>): string;
