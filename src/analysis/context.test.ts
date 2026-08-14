import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { ValidationError } from "../validation/rules.js";
import { getProjectContext } from "./context.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-context-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("getProjectContext", () => {
  it("throws for an unknown node id", () => {
    expect(() => getProjectContext(store, "does-not-exist")).toThrow(ValidationError);
  });

  it("includes the full focus node and a bounded set of related nodes by default", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" }, domain.id);
    const ctx = getProjectContext(store, route.id);
    expect(ctx.focus.id).toBe(route.id);
    expect(ctx.focus.props).toEqual({ path: "/login" });
    expect(ctx.related.map((r) => r.nodeId)).toContain(domain.id);
    expect(ctx.related.find((r) => r.nodeId === domain.id)?.direction).toBe("dependency");
    // related entries are summaries, never full props
    expect((ctx.related[0] as Record<string, unknown>).props).toBeUndefined();
  });

  it("clamps depth to 5 even if a larger value is requested", () => {
    let parent = store.createNode("domain", { name: "root" });
    for (let i = 0; i < 8; i++) parent = store.createNode("route", { path: `/${i}` }, parent.id);
    const ctx = getProjectContext(store, parent.id, { depth: 9999, direction: "dependencies" });
    expect(Math.max(...ctx.related.map((r) => r.depth))).toBeLessThanOrEqual(5);
  });

  it("clamps maxNodes to 200 and reports truncation", () => {
    const domain = store.createNode("domain", { name: "root" });
    for (let i = 0; i < 210; i++) store.createNode("route", { path: `/${i}` }, domain.id);
    const ctx = getProjectContext(store, domain.id, { direction: "dependents", maxNodes: 100000 });
    expect(ctx.related.length).toBeLessThanOrEqual(200);
    expect(ctx.truncated).toBe(true);
    expect(ctx.totalRelatedFound).toBe(210);
  });

  it("direction filters to only dependencies or only dependents", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" }, domain.id);
    const depsOnly = getProjectContext(store, route.id, { direction: "dependencies" });
    expect(depsOnly.related.every((r) => r.direction === "dependency")).toBe(true);

    const dependentsOnly = getProjectContext(store, domain.id, { direction: "dependents" });
    expect(dependentsOnly.related.every((r) => r.direction === "dependent")).toBe(true);
    expect(dependentsOnly.related.map((r) => r.nodeId)).toContain(route.id);
  });
});
