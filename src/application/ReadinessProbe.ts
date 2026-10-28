export interface StoreStatus {
  readonly reachable: boolean;
  /** Why the store is unreachable, for operators. Never contains credentials. */
  readonly error?: string;
}

/** Port: reports whether the backing store is reachable. */
export interface ReadinessProbe {
  check(): Promise<StoreStatus>;
}

export const alwaysReachable: ReadinessProbe = { check: async () => ({ reachable: true }) };
