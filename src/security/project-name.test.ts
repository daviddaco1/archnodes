import { describe, expect, it } from "vitest";
import { assertValidProjectName } from "./project-name.js";

describe("assertValidProjectName", () => {
  it("accepts alphanumeric names with underscores/hyphens", () => {
    expect(() => assertValidProjectName("my-project_1")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => assertValidProjectName("../../etc/passwd")).toThrow();
    expect(() => assertValidProjectName("..")).toThrow();
  });

  it("rejects path separators", () => {
    expect(() => assertValidProjectName("a/b")).toThrow();
    expect(() => assertValidProjectName("a\\b")).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => assertValidProjectName("")).toThrow();
  });
});
