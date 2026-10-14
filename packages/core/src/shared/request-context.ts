import { AsyncLocalStorage } from "node:async_hooks";

/** Who is acting, recorded on audit logs and order events. */
export interface Actor {
  readonly type: "CUSTOMER" | "STAFF" | "SYSTEM" | "PROVIDER";
  readonly id?: string;
}

export interface RequestContext {
  /** From the `x-request-id` header set in proxy.ts, or generated for jobs. */
  readonly requestId: string;
  readonly actor?: Actor;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` available to everything it calls, including async continuations. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
