import { describe, expect, it } from "vitest";
import { generateSyntheticGraph } from "./synth.js";
import { validateProjectGraph } from "../validation/rules.js";

describe("generateSyntheticGraph", () => {
  it("produces a graph that is legal per the schema's own rules — measuring on invalid data would measure nothing useful", () => {
    const graph = generateSyntheticGraph(100);
    const result = validateProjectGraph(graph);
    expect(result.valid).toBe(true);
  });

  it("scales roughly to the requested size", () => {
    expect(generateSyntheticGraph(150).nodes.length).toBeGreaterThanOrEqual(150);
    expect(generateSyntheticGraph(15).nodes.length).toBeGreaterThanOrEqual(15);
  });
});
