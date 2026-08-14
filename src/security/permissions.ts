// Seam, not a system: a flat two-level table (read/write) that's enough to gate REST/MCP access
// today without precluding a finer per-action matrix later — canPerform is the one function that'd
// need to change for that, nothing else. No user table, no per-node ACL, no UI.
export type Role = "owner" | "admin" | "editor" | "viewer" | "agent";

export type PermissionAction = "read" | "write";

export function canPerform(role: Role, action: PermissionAction): boolean {
  if (action === "read") return true;
  return role !== "viewer";
}
