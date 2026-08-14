import { getAffectedNodes, getDependents, type AffectedNode, type RelatedNode } from "./dependencies.js";
import { ValidationError, validateProjectGraph, type ValidationIssue } from "../validation/rules.js";
import type { ProjectStore } from "../store/project-store.js";

export type ChangeType = "delete" | "modify";

export interface ChangeImpact {
  changeType: ChangeType;
  nodeId: string;
  dependents: RelatedNode[];
  affected: AffectedNode[];
  // delete-only
  wouldCascade?: boolean;
  danglingRefsOnDelete?: { nodeId: string; field?: string }[];
  // modify-only
  newIssues?: ValidationIssue[];
}

export interface ChangePlan {
  impact: ChangeImpact;
  steps: string[];
  summary: string;
}

function requireNode(store: ProjectStore, nodeId: string) {
  const node = store.getNode(nodeId);
  if (!node) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId, message: `Node ${nodeId} not found` }]);
  return node;
}

// Forces store.transaction() to roll back unconditionally — analyzeChange never wants the modify
// dry-run to actually commit, whether or not the patch itself was structurally valid.
class DryRunAbort extends Error {
  constructor(public result: { newIssues: ValidationIssue[] }) {
    super("dry-run-abort");
  }
}

// Read-only: never mutates the project. "delete" reasons about the graph as it stands today;
// "modify" actually runs the patch inside a transaction that always rolls back, then diffs
// validateProjectGraph() before/after — reusing the Fase 2 transaction machinery instead of a
// separate simulation engine.
export function analyzeChange(
  store: ProjectStore,
  nodeId: string,
  changeType: ChangeType,
  opts?: { propsPatch?: unknown },
): ChangeImpact {
  requireNode(store, nodeId);
  const graph = store.getProject("all");
  const dependents = getDependents(nodeId, graph);
  const affected = getAffectedNodes(nodeId, graph);

  if (changeType === "delete") {
    const wouldCascade = dependents.some((d) => d.kind === "hierarchy-child");
    const danglingRefsOnDelete = dependents
      .filter((d) => d.kind === "ref")
      .map((d) => ({ nodeId: d.nodeId, field: d.field }));
    return { changeType, nodeId, dependents, affected, wouldCascade, danglingRefsOnDelete };
  }

  try {
    store.transaction((tx) => {
      const before = validateProjectGraph(tx.getProject("all"));
      tx.updateNode(nodeId, opts?.propsPatch ?? {});
      const after = validateProjectGraph(tx.getProject("all"));
      const beforeKeys = new Set(before.issues.map((i) => JSON.stringify(i)));
      const newIssues = after.issues.filter((i) => !beforeKeys.has(JSON.stringify(i)));
      throw new DryRunAbort({ newIssues });
    });
    /* istanbul ignore next -- the callback above always throws DryRunAbort */
    return { changeType, nodeId, dependents, affected, newIssues: [] };
  } catch (err) {
    if (err instanceof DryRunAbort) {
      return { changeType, nodeId, dependents, affected, newIssues: err.result.newIssues };
    }
    throw err; // the patch itself was invalid (e.g. broken ref) — a real error, not an analysis result
  }
}

// plan_change never touches code (the store has no access to the user's filesystem in general) —
// its scope is "what graph operations are needed and what to review", not a code diff. Translating
// that into actual source changes is project-scaffold.md / project-sync.md's job, not this one's.
export function planChange(
  store: ProjectStore,
  nodeId: string,
  changeType: ChangeType,
  opts?: { propsPatch?: unknown },
): ChangePlan {
  const impact = analyzeChange(store, nodeId, changeType, opts);
  const node = requireNode(store, nodeId);
  const steps: string[] = [];

  if (changeType === "delete") {
    if (impact.wouldCascade) {
      const childIds = impact.dependents.filter((d) => d.kind === "hierarchy-child").map((d) => d.nodeId);
      steps.push(`delete_node(${nodeId}, cascade:true) — also removes ${childIds.join(", ")}`);
    } else {
      steps.push(`delete_node(${nodeId})`);
    }
    if (impact.danglingRefsOnDelete && impact.danglingRefsOnDelete.length > 0) {
      steps.push(
        `Review ${impact.danglingRefsOnDelete.length} incoming reference(s) that will be cleared automatically: ` +
          impact.danglingRefsOnDelete.map((r) => `${r.nodeId} (${r.field})`).join(", "),
      );
    }
  } else {
    steps.push(`update_node(${nodeId}, <props>)`);
    if (impact.newIssues && impact.newIssues.length > 0) {
      steps.push(`Fix ${impact.newIssues.length} new validation issue(s) this change would introduce`);
    }
  }
  if (impact.affected.length > 0) {
    steps.push(`Review ${impact.affected.length} transitively affected node(s)`);
  }
  steps.push("Run validate_project() / analyze_health() again before committing");

  const summary =
    changeType === "delete"
      ? `Deleting ${node.type} "${node.label}" would ${impact.wouldCascade ? "cascade to its children and " : ""}affect ${impact.affected.length} other node(s).`
      : `Modifying ${node.type} "${node.label}" would introduce ${impact.newIssues?.length ?? 0} new validation issue(s) and affect ${impact.affected.length} other node(s).`;

  return { impact, steps: steps.map((s, i) => `${i + 1}. ${s}`), summary };
}
