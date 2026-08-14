import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { ValidationError } from "../validation/rules.js";
import { analyzeChange, planChange } from "./change.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-change-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("analyzeChange", () => {
  it("throws for an unknown node id", () => {
    expect(() => analyzeChange(store, "does-not-exist", "delete")).toThrow(ValidationError);
  });

  it("delete: flags wouldCascade when the node has hierarchy children", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" }, domain.id);
    const impact = analyzeChange(store, domain.id, "delete");
    expect(impact.wouldCascade).toBe(true);
    expect(impact.dependents).toContainEqual({ nodeId: route.id, kind: "hierarchy-child" });
  });

  it("delete: lists incoming refs that would be silently cleared", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    store.createNode("errorHandler", { name: "AuthErrors", scope: "domain", domainId: domain.id });
    const impact = analyzeChange(store, domain.id, "delete");
    expect(impact.danglingRefsOnDelete).toContainEqual({ nodeId: expect.any(String), field: "domainId" });
  });

  it("delete: never mutates the project", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    store.createNode("route", { path: "/login" }, domain.id);
    analyzeChange(store, domain.id, "delete");
    expect(store.getProject("all").nodes).toHaveLength(2);
  });

  it("modify: reports new validation issues the patch would introduce, without mutating the project", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    // getProject("all") returns the live, uncloned graph (per its own contract) — snapshot it
    // ourselves so the comparison isn't against an object the dry-run mutates in place pre-rollback.
    const before = structuredClone(store.getProject("all"));
    const impact = analyzeChange(store, domain.id, "modify", { propsPatch: { name: "" } }); // "" counts as missing
    expect(impact.newIssues?.some((i) => i.code === "MISSING_FIELD")).toBe(true);
    expect(store.getProject("all")).toEqual(before);
  });

  it("modify: re-throws a genuinely invalid patch instead of returning it as an analysis result", () => {
    const endpoint = store.createNode("endpoint", { name: "login", methods: ["GET"] });
    const operation = store.createNode("operation", { method: "GET" }, endpoint.id);
    expect(() => analyzeChange(store, operation.id, "modify", { propsPatch: { method: "POST" } })).toThrow(ValidationError);
    expect(store.getNode(operation.id)?.props).toMatchObject({ method: "GET" }); // untouched
  });
});

describe("planChange", () => {
  it("delete plan mentions cascade and the children it would remove", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const route = store.createNode("route", { path: "/login" }, domain.id);
    const plan = planChange(store, domain.id, "delete");
    expect(plan.steps.some((s) => s.includes("cascade:true") && s.includes(route.id))).toBe(true);
    expect(plan.summary).toContain("cascade");
  });

  it("modify plan summarizes the number of new issues and affected nodes", () => {
    const domain = store.createNode("domain", { name: "Auth" });
    const plan = planChange(store, domain.id, "modify", { propsPatch: { name: "" } });
    expect(plan.summary).toMatch(/new validation issue/);
    expect(plan.steps[plan.steps.length - 1]).toMatch(/validate_project|analyze_health/);
  });
});
