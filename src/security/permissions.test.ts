import { describe, expect, it } from "vitest";
import { canPerform, type Role } from "./permissions.js";

const ALL_ROLES: Role[] = ["owner", "admin", "editor", "viewer", "agent"];

describe("canPerform", () => {
  it("every role can read", () => {
    for (const role of ALL_ROLES) expect(canPerform(role, "read")).toBe(true);
  });

  it("every role except viewer can write", () => {
    for (const role of ALL_ROLES) {
      expect(canPerform(role, "write")).toBe(role !== "viewer");
    }
  });
});
