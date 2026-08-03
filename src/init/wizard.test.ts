import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { applyWizardAnswers } from "./wizard.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-wizard-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("applyWizardAnswers", () => {
  it("sets manifest fields and creates one domain per entry", () => {
    applyWizardAnswers(store, {
      language: "TypeScript",
      framework: "Express",
      database: "PostgreSQL",
      architecture: "monolith",
      domains: ["Auth", "Billing"],
    });

    const graph = store.getProject("all");
    expect(graph.manifest.language).toBe("TypeScript");
    expect(graph.manifest.framework).toBe("Express");
    expect(graph.manifest.databases).toEqual(["PostgreSQL"]);
    expect(store.listNodes("domain")).toHaveLength(2);
    expect(store.listNodes("db")).toHaveLength(1);
  });

  it("skips creating a db node when no database was chosen", () => {
    applyWizardAnswers(store, {
      language: "TypeScript",
      framework: "Express",
      database: "",
      architecture: "monolith",
      domains: [],
    });
    expect(store.listNodes("db")).toHaveLength(0);
  });
});
