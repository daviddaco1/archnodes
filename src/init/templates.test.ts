import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../store/project-store.js";
import { applyTemplate, TEMPLATES } from "./templates.js";

let baseDir: string;
let store: ProjectStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pv-tpl-test-"));
  store = createProjectStore(`test-${randomUUID()}`, { baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("applyTemplate", () => {
  for (const template of TEMPLATES) {
    it(`applies "${template.id}"`, () => {
      applyTemplate(store, template.id);
      const graph = store.getProject("all");
      expect(graph.manifest.language).toBe(template.language);
      expect(graph.manifest.framework).toBe(template.framework);
      expect(graph.manifest.architecture).toBe(template.architecture);
      expect(store.listNodes("db")).toHaveLength(1);
      expect(store.listNodes("orm")).toHaveLength(1);
    });
  }

  it("throws for an unknown template id", () => {
    expect(() => applyTemplate(store, "does-not-exist")).toThrow();
  });
});
