import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  readonly requestId: string;
}

/** Carries per-request data (correlation id) to any log line without threading it through call signatures. */
export const requestContext = new AsyncLocalStorage<RequestContext>();
