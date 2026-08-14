import { describe, expect, it } from "vitest";
import { buildRuleMap, compatibleSources, compatibleTargets, edgeKind, isValidConnection } from "./edgeValidation";
import type { SchemaConnection } from "../../api/client";

const connections: SchemaConnection[] = [
  { from: "domain", to: "route", kind: "hierarchy" },
  { from: "domain", to: "subdomain", kind: "hierarchy" },
  { from: "route", to: "endpoint", kind: "hierarchy" },
  { from: "endpoint", to: "redisKey", kind: "invalidates" },
];

describe("buildRuleMap / isValidConnection / edgeKind", () => {
  const rules = buildRuleMap(connections);

  it("recognizes a valid pair", () => {
    expect(isValidConnection(rules, "domain", "route")).toBe(true);
    expect(edgeKind(rules, "domain", "route")).toBe("hierarchy");
  });

  it("rejects an unlisted pair", () => {
    expect(isValidConnection(rules, "domain", "endpoint")).toBe(false);
    expect(edgeKind(rules, "domain", "endpoint")).toBeUndefined();
  });

  it("distinguishes edge kind per pair", () => {
    expect(edgeKind(rules, "endpoint", "redisKey")).toBe("invalidates");
  });
});

describe("compatibleTargets / compatibleSources", () => {
  const rules = buildRuleMap(connections);

  it("lists every type a source can connect to", () => {
    expect(compatibleTargets(rules, "domain").sort()).toEqual(["route", "subdomain"]);
  });

  it("returns an empty list for a type with no outgoing rules", () => {
    expect(compatibleTargets(rules, "redisKey")).toEqual([]);
  });

  it("lists every type that can connect into a target", () => {
    expect(compatibleSources(rules, "route")).toEqual(["domain"]);
  });
});
