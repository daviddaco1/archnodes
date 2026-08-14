import { checkProjectHealth, type ProjectHealth } from "../validation/health.js";
import { validateProjectGraph, type ValidationResult } from "../validation/rules.js";
import { buildDependentsIndex, getAffectedNodes } from "./dependencies.js";
import type { NodeType, ProjectGraph } from "../types/graph.js";

export interface ProjectSummary {
  totalNodes: number;
  totalEdges: number;
  nodeCounts: Partial<Record<NodeType, number>>;
  health: ProjectHealth;
  validation: ValidationResult;
  topConnected: { nodeId: string; type: NodeType; label: string; affectedCount: number }[];
  unimplemented: { nodeId: string; type: NodeType; label: string }[];
}

// Structural types (container/boundary/note) are visual-only and never "implemented" in any
// sense — excluding them keeps `unimplemented` meaningful instead of always listing every one.
const STRUCTURAL_TYPES = new Set<NodeType>(["container", "boundary", "note"]);

// An executive summary layered on data that already exists — never recomputes validation/health,
// just aggregates them alongside counts and connectivity.
export function summarizeProject(graph: ProjectGraph, topN = 10): ProjectSummary {
  const nodeCounts: Partial<Record<NodeType, number>> = {};
  for (const node of graph.nodes) nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;

  // Built once and reused for every node's BFS below — otherwise each getAffectedNodes() call
  // would rebuild the reverse-ref index from scratch, right back to O(nodes²).
  const dependentsIndex = buildDependentsIndex(graph);
  const topConnected = graph.nodes
    .map((n) => ({ nodeId: n.id, type: n.type, label: n.label, affectedCount: getAffectedNodes(n.id, graph, { index: dependentsIndex }).length }))
    .sort((a, b) => b.affectedCount - a.affectedCount)
    .slice(0, topN);

  const unimplemented = graph.nodes
    .filter((n) => !STRUCTURAL_TYPES.has(n.type) && !n.generated && !n.sourcePath)
    .map((n) => ({ nodeId: n.id, type: n.type, label: n.label }));

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodeCounts,
    health: checkProjectHealth(graph),
    validation: validateProjectGraph(graph),
    topConnected,
    unimplemented,
  };
}
