import { buildDependentsIndex, getDependents } from "../analysis/dependencies.js";
import type { NodeType, ProjectGraph } from "../types/graph.js";
import { HIERARCHY_RULES, REF_FIELDS, collectRefValues, validateProjectGraph, type ValidationIssue } from "./rules.js";

// A "diagnostic" layer on top of validateProjectGraph()'s hard structural rules — never write-
// blocking, never changes what assertValidNode() rejects. Kept in its own module rather than
// rules.ts because it answers a different question (graph quality, not graph legality).

// Types that HIERARCHY_RULES/REF_FIELDS never list as a target are expected to float free (domain,
// page, container/boundary/note, ...) — only types that ARE normally pointed at are worth flagging
// when a specific instance has nothing pointing at it.
function collectNonRootTypes(): Set<NodeType> {
  const targets = new Set<NodeType>();
  for (const children of Object.values(HIERARCHY_RULES)) {
    for (const t of children ?? []) targets.add(t);
  }
  for (const specs of Object.values(REF_FIELDS)) {
    for (const spec of specs ?? []) {
      const types = Array.isArray(spec.targetType) ? spec.targetType : [spec.targetType];
      for (const t of types) targets.add(t);
    }
  }
  return targets;
}

export function findOrphanNodes(graph: ProjectGraph): ValidationIssue[] {
  const nonRootTypes = collectNonRootTypes();
  const referenced = new Set<string>();
  for (const node of graph.nodes) {
    const specs = REF_FIELDS[node.type] ?? [];
    const props = (node.props ?? {}) as Record<string, unknown>;
    for (const spec of specs) for (const id of collectRefValues(props, spec)) referenced.add(id);
  }
  for (const edge of graph.edges) {
    if (edge.edgeType === "hierarchy" || edge.edgeType === "invalidates") referenced.add(edge.target);
  }

  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    if (!nonRootTypes.has(node.type)) continue;
    if (node.parentId || referenced.has(node.id)) continue;
    issues.push({
      level: "warning",
      code: "ORPHAN_NODE",
      nodeId: node.id,
      message: `Node ${node.id} (${node.type}) has no parent and nothing references it`,
    });
  }
  return issues;
}

// Types where "declared but never consumed" is worth a nudge — not exhaustive (e.g. flagging every
// unused `middleware` would be noisy for perfectly fine reusable ones), just the shapes most likely
// to be genuine dead weight.
const UNUSED_CHECK_TYPES = new Set<NodeType>(["service", "model", "table", "component"]);

export function findUnusedNodes(graph: ProjectGraph): ValidationIssue[] {
  // Built once and reused across every candidate below — calling getDependents() in a loop
  // without this turns this function O(nodes²) (each call was its own O(nodes) scan).
  const index = buildDependentsIndex(graph);
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    if (!UNUSED_CHECK_TYPES.has(node.type)) continue;
    if (getDependents(node.id, graph, index).length === 0) {
      issues.push({
        level: "warning",
        code: "UNUSED_NODE",
        nodeId: node.id,
        message: `Node ${node.id} (${node.type}) has no dependents`,
      });
    }
  }
  return issues;
}

// Hierarchy/containerId cycles are already rejected at write time (project-store.ts); REF_FIELDS
// cycles (e.g. two middlewares chaining to each other via returns[].chainToId) are not — this is
// the one place that looks for them, via a standard 3-color DFS over the ref-field graph.
export function findRefCycles(graph: ProjectGraph): ValidationIssue[] {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const specs = REF_FIELDS[node.type] ?? [];
    const props = (node.props ?? {}) as Record<string, unknown>;
    const targets: string[] = [];
    for (const spec of specs) targets.push(...collectRefValues(props, spec));
    adjacency.set(node.id, targets);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(graph.nodes.map((n) => [n.id, WHITE]));
  const issues: ValidationIssue[] = [];
  const reportedCycles = new Set<string>();

  function dfs(id: string, path: string[]): void {
    color.set(id, GRAY);
    path.push(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!color.has(next)) continue; // dangling ref — validateRefs()/BROKEN_REF already covers this
      if (color.get(next) === GRAY) {
        const cycle = path.slice(path.indexOf(next));
        const key = [...cycle].sort().join(",");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          issues.push({
            level: "warning",
            code: "REF_CYCLE",
            nodeId: cycle[0],
            message: `Reference cycle detected: ${[...cycle, next].join(" -> ")}`,
          });
        }
      } else if (color.get(next) === WHITE) {
        dfs(next, path);
      }
    }
    path.pop();
    color.set(id, BLACK);
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) dfs(node.id, []);
  }

  return issues;
}

export interface ProjectHealth {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  issues: ValidationIssue[];
}

export function checkProjectHealth(graph: ProjectGraph): ProjectHealth {
  const all = [
    ...validateProjectGraph(graph).issues,
    ...findOrphanNodes(graph),
    ...findUnusedNodes(graph),
    ...findRefCycles(graph),
  ];
  return {
    errors: all.filter((i) => i.level === "error"),
    warnings: all.filter((i) => i.level === "warning"),
    info: all.filter((i) => i.level === "info"),
    issues: all,
  };
}
