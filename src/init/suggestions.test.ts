import { describe, expect, it } from "vitest";
import { suggestFrameworks, suggestStack } from "./suggestions.js";

describe("suggestFrameworks", () => {
  it("includes Express for TypeScript", () => {
    expect(suggestFrameworks("TypeScript")).toContain("Express");
  });
  it("returns an empty list for an unknown language", () => {
    expect(suggestFrameworks("Rust")).toEqual([]);
  });
});

describe("suggestStack", () => {
  it("suggests TypeORM + PostgreSQL for NestJS", () => {
    expect(suggestStack("NestJS")).toEqual({ orm: "TypeORM", database: "PostgreSQL" });
  });
  it("returns undefined for an unknown framework", () => {
    expect(suggestStack("Rocket")).toBeUndefined();
  });
});
