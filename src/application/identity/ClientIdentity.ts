export interface ClientIdentity {
  readonly id: string;
  readonly tier: string;
}

/** Transport-agnostic view of an incoming request. */
export interface ClientRequest {
  readonly ip: string;
  header(name: string): string | undefined;
}

/** Strategy: one way of recognising who is calling. */
export interface ClientIdentifier {
  identify(request: ClientRequest): ClientIdentity | undefined;
}
