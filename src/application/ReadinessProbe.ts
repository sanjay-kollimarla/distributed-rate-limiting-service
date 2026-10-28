/** Port: reports whether the backing store is reachable. */
export interface ReadinessProbe {
  isStoreReachable(): Promise<boolean>;
}

export const alwaysReachable: ReadinessProbe = { isStoreReachable: async () => true };
