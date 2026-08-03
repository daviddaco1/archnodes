import type { SchemaConnection } from "../../api/client";
import type { EdgeType, NodeType } from "../../types/graph";

export type ConnectionRules = Map<string, EdgeType>;

export function buildRuleMap(connections: SchemaConnection[]): ConnectionRules {
  const map: ConnectionRules = new Map();
  for (const c of connections) map.set(`${c.from}->${c.to}`, c.kind);
  return map;
}

export function isValidConnection(rules: ConnectionRules, sourceType: NodeType, targetType: NodeType): boolean {
  return rules.has(`${sourceType}->${targetType}`);
}

export function edgeKind(rules: ConnectionRules, sourceType: NodeType, targetType: NodeType): EdgeType | undefined {
  return rules.get(`${sourceType}->${targetType}`);
}
