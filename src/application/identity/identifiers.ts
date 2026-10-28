import type { ClientIdentifier, ClientIdentity, ClientRequest } from "./ClientIdentity";

/** Raised when a client presents credentials we do not recognise. */
export class UnauthorizedClientError extends Error {
  override readonly name = "UnauthorizedClientError";
}

/**
 * Absent header: not this identifier's concern. Present but unknown key: rejected,
 * so a typo never silently downgrades a client to a different tier.
 */
export class ApiKeyIdentifier implements ClientIdentifier {
  constructor(
    private readonly directory: ReadonlyMap<string, ClientIdentity>,
    private readonly headerName = "x-api-key",
  ) {}

  identify(request: ClientRequest): ClientIdentity | undefined {
    const apiKey = request.header(this.headerName);
    if (apiKey === undefined) return undefined;
    const identity = this.directory.get(apiKey);
    if (!identity) throw new UnauthorizedClientError("Unknown API key");
    return identity;
  }
}

export class IpAddressIdentifier implements ClientIdentifier {
  constructor(private readonly tier = "anonymous") {}

  identify(request: ClientRequest): ClientIdentity {
    return { id: `ip:${request.ip}`, tier: this.tier };
  }
}

/** Composite: a list of identifiers that behaves as one; the first match wins. */
export class CompositeClientIdentifier implements ClientIdentifier {
  private readonly children: readonly ClientIdentifier[];

  constructor(...children: ClientIdentifier[]) {
    this.children = children;
  }

  identify(request: ClientRequest): ClientIdentity | undefined {
    for (const child of this.children) {
      const identity = child.identify(request);
      if (identity) return identity;
    }
    return undefined;
  }
}

const DEMO_ID = /^[\w-]{1,64}$/;
const DEMO_TIER = /^[a-z]{1,16}$/;

/**
 * Lets the demo UI simulate many distinct clients from one browser. It trusts the caller
 * to name its own identity and tier, so it must only be enabled in demo mode.
 */
export class DemoClientIdentifier implements ClientIdentifier {
  identify(request: ClientRequest): ClientIdentity | undefined {
    const id = request.header("x-demo-client-id");
    if (id === undefined) return undefined;
    const tier = request.header("x-demo-tier") ?? "anonymous";
    if (!DEMO_ID.test(id) || !DEMO_TIER.test(tier)) {
      throw new UnauthorizedClientError("Malformed demo client headers");
    }
    return { id: `demo:${id}`, tier };
  }
}
