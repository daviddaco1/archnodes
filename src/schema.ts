import { HIERARCHY_RULES, REQUIRED_FIELDS, REF_FIELDS, SPECIAL_EDGES } from "./validation/rules.js";
import type { NodeType } from "./types/graph.js";

// Shared schema response shape for both transports (REST GET /api/schema and MCP get_schema) —
// keep this the one place that assembles it so the two never drift into different key names.
export function buildSchemaResponse() {
  const connections: { from: NodeType; to: NodeType; kind: "hierarchy" | "invalidates" }[] = [];
  for (const [from, targets] of Object.entries(HIERARCHY_RULES) as [NodeType, NodeType[]][]) {
    for (const to of targets) connections.push({ from, to, kind: "hierarchy" });
  }
  for (const from of SPECIAL_EDGES.invalidates.from) {
    for (const to of SPECIAL_EDGES.invalidates.to) connections.push({ from, to, kind: "invalidates" });
  }
  return {
    connections,
    nodeTypes: Object.keys(REQUIRED_FIELDS) as NodeType[],
    requiredFields: REQUIRED_FIELDS,
    refFields: REF_FIELDS,
  };
}
