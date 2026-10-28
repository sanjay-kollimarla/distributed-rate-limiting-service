import type { AlgorithmFactory, Limiter } from "../domain/RateLimitAlgorithm";
import { AlgorithmRouter } from "./AlgorithmRouter";

export type LimiterDecorator = (inner: Limiter) => Limiter;

/**
 * Builder: assembles the limiter pipeline. The first `with` call wraps the
 * router directly; each later call wraps the previous result (outermost last).
 */
export class LimiterPipelineBuilder {
  private readonly decorators: LimiterDecorator[] = [];

  constructor(private readonly factory: AlgorithmFactory) {}

  with(decorator: LimiterDecorator): this {
    this.decorators.push(decorator);
    return this;
  }

  build(): Limiter {
    const router = new AlgorithmRouter(this.factory.createAlgorithms());
    return this.decorators.reduce<Limiter>((inner, decorate) => decorate(inner), router);
  }
}
