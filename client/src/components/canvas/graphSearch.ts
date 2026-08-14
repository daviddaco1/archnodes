import { nodeSchemas } from "../../schema/nodeSchemas";
import { pickTitle, formatSummaryValue } from "./GenericNode";
import type { AnyGraphNode, NodeType } from "@project-visualizer/shared/graph.js";

// Case-insensitive substring over id, resolved title, and summary fields — no fuzzy/scoring, a
// graph of this size doesn't need it and it would just add complexity without a real ask for it.
export function matchesQuery(node: AnyGraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const schema = nodeSchemas[node.type];
  const props = node.props as Record<string, unknown>;
  if (node.id.toLowerCase().includes(q)) return true;
  if (pickTitle(schema, props).toLowerCase().includes(q)) return true;
  for (const field of schema.summaryFields) {
    if (formatSummaryValue(props[field]).toLowerCase().includes(q)) return true;
  }
  return false;
}

export function filterByTypes(nodes: AnyGraphNode[], allowed: Set<NodeType> | null): AnyGraphNode[] {
  if (!allowed) return nodes;
  return nodes.filter((n) => allowed.has(n.type));
}
