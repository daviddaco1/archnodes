import type { SchemaConnection } from "../../api/client";
import type { EdgeType, NodeType } from "@project-visualizer/shared/graph.js";

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

// All node types `sourceType` is allowed to connect to (as an edge source), used for the
// "+" quick-add affordance on a node's output handle.
export function compatibleTargets(rules: ConnectionRules, sourceType: NodeType): NodeType[] {
  const prefix = `${sourceType}->`;
  const targets: NodeType[] = [];
  for (const key of rules.keys()) {
    if (key.startsWith(prefix)) targets.push(key.slice(prefix.length) as NodeType);
  }
  return targets;
}

// All node types that are allowed to connect INTO `targetType` (as an edge source), used to
// highlight valid drop targets while the user is dragging a connection from a target handle.
export function compatibleSources(rules: ConnectionRules, targetType: NodeType): NodeType[] {
  const suffix = `->${targetType}`;
  const sources: NodeType[] = [];
  for (const key of rules.keys()) {
    if (key.endsWith(suffix)) sources.push(key.slice(0, -suffix.length) as NodeType);
  }
  return sources;
}
