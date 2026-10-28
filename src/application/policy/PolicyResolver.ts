import type { RateLimitPolicy } from "../../domain/RateLimitPolicy";
import type { ClientIdentity } from "../identity/ClientIdentity";

export interface RateLimitContext {
  readonly client: ClientIdentity;
  /** e.g. "POST /api/orders" */
  readonly route: string;
}

/** Handler in the resolution chain; returns undefined to pass the request along. */
export interface PolicyRule {
  resolve(context: RateLimitContext): RateLimitPolicy | undefined;
}

export class NoApplicablePolicyError extends Error {
  override readonly name = "NoApplicablePolicyError";
}

/** Chain of Responsibility: the first rule that claims the context decides its policy. */
export class PolicyResolver {
  private readonly rules: readonly PolicyRule[];

  constructor(...rules: PolicyRule[]) {
    this.rules = rules;
  }

  resolve(context: RateLimitContext): RateLimitPolicy {
    for (const rule of this.rules) {
      const policy = rule.resolve(context);
      if (policy) return policy;
    }
    throw new NoApplicablePolicyError(`No policy for ${context.client.id} on ${context.route}`);
  }
}
