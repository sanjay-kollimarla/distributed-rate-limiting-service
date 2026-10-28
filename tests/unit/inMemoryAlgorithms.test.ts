import { InMemoryAlgorithmFactory } from "../../src/infrastructure/memory/InMemoryAlgorithmFactory";
import { describeAlgorithmContract } from "../support/algorithmContract";
import { ManualClock } from "../support/ManualClock";

const clock = new ManualClock();

describeAlgorithmContract(
  "in-memory",
  () => new InMemoryAlgorithmFactory(clock).createAlgorithms(),
  async (ms) => clock.advance(ms),
);
