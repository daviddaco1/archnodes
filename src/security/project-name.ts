// The only guard against path traversal via `--project`: a whitelist regex rejects any `..`,
// path separator, or empty name in one shot — simpler and more robust than resolving the path and
// comparing prefixes. Enforced at the single real entry point (createProjectStore), used by REST,
// MCP, and the CLI's init/wizard/template paths alike.
export function assertValidProjectName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(name)) {
    throw new Error(`Invalid project name "${name}": only letters, digits, "_" and "-" are allowed`);
  }
}
