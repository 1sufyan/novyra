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
  timeoutMs?: number;
}): Promise<StartedApp>;
