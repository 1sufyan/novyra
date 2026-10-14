export function freePort(): Promise<number>;

export interface StartedApp {
  /** Base URL, e.g. http://127.0.0.1:41234 */
  readonly url: string;
  /** Set when the process has exited (for example after failing env validation). */
  readonly exitCode: number | undefined;
  /** Everything the process printed so far. */
  readonly output: string;
  stop(): Promise<void>;
}

export function startApp(options: {
  cwd: string;
  env?: Record<string, string | undefined>;
  /** false: run `next start` without the check-env step, to exercise the runtime re-check. */
  checkEnv?: boolean;
  timeoutMs?: number;
}): Promise<StartedApp>;

/** Runs a package script to completion; it is killed (exit code 137) after `timeoutMs`. */
export function runScript(options: {
  cwd: string;
  script: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<{ exitCode: number; output: string }>;

export function assertSecurityHeaders(
  response: Response,
  options: { coop: "same-origin" | "same-origin-allow-popups" },
): void;

export function assertRequestIds(url: string): Promise<void>;
