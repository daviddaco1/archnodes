import type { EdgeType, NodeType } from "../types/graph.js";
import type { ProjectStore, TransactionMeta } from "../store/project-store.js";

// `tempId` is a caller-local key (never persisted) so a batch can reference "the domain I'm
// about to create" as a parent/edge endpoint before it has a real id — the same problem
// import_graph's merge-by-id can't solve for a re-import that doesn't know the previous ids.
export interface ImportCandidateNode {
  tempId: string;
  type: NodeType;
  props: unknown;
  parentId?: string; // a real existing id, or another candidate's tempId in this same batch
  sourcePath?: string; // matching key against nodes already in the graph
  sourceHash?: string; // if present, recordSync() fires as soon as the id is resolved
}

export interface ImportCandidateEdge {
  sourceId: string; // real id or tempId
  targetId: string; // real id or tempId
  edgeType?: EdgeType;
}

export interface ImportProjectResult {
  created: { tempId: string; id: string }[];
  updated: { tempId: string; id: string }[];
  // Existing nodes with a sourcePath that this batch didn't mention — report only, never deleted.
  // Only reliable when the batch represents a full re-scan of the same root as a prior import.
  orphaned: { id: string; sourcePath: string }[];
  // Same sourcePath, different node type — the existing node is left untouched.
  conflicts: { tempId: string; sourcePath: string; existingId: string; reason: string }[];
}

export function importProject(
  store: ProjectStore,
  nodes: ImportCandidateNode[],
  edges: ImportCandidateEdge[],
  meta?: TransactionMeta,
): ImportProjectResult {
  return store.transaction(
    (tx) => {
      const graph = tx.getProject("all");
      const existingBySourcePath = new Map(
        graph.nodes.filter((n) => n.sourcePath).map((n) => [n.sourcePath as string, n]),
      );
      const seenSourcePaths = new Set<string>();
      const tempIdToRealId = new Map<string, string>();
      const result: ImportProjectResult = { created: [], updated: [], orphaned: [], conflicts: [] };

      const resolveId = (id: string): string => tempIdToRealId.get(id) ?? id;

      for (const candidate of nodes) {
        if (candidate.sourcePath) seenSourcePaths.add(candidate.sourcePath);
        const existing = candidate.sourcePath ? existingBySourcePath.get(candidate.sourcePath) : undefined;

        let resolvedId: string;
        if (existing) {
          tempIdToRealId.set(candidate.tempId, existing.id);
          resolvedId = existing.id;
          if (existing.type === candidate.type) {
            tx.updateNode(existing.id, candidate.props);
            result.updated.push({ tempId: candidate.tempId, id: existing.id });
          } else {
            result.conflicts.push({
              tempId: candidate.tempId,
              sourcePath: candidate.sourcePath as string,
              existingId: existing.id,
              reason: `sourcePath "${candidate.sourcePath}" is already a ${existing.type} node, but this candidate is ${candidate.type}`,
            });
          }
        } else {
          const parentId = candidate.parentId ? resolveId(candidate.parentId) : undefined;
          const created = tx.createNode(candidate.type, candidate.props, parentId);
          tempIdToRealId.set(candidate.tempId, created.id);
          resolvedId = created.id;
          result.created.push({ tempId: candidate.tempId, id: created.id });
        }

        // Conflicting nodes are left untouched but still get recordSync — a mismatched type is
        // reported, not silently overwritten, yet the sync stamp still needs to land somewhere
        // resolvable so a later sync pass doesn't treat this sourcePath as untracked.
        if (candidate.sourceHash !== undefined) {
          tx.recordSync(resolvedId, { sourceHash: candidate.sourceHash, sourcePath: candidate.sourcePath });
        }
      }

      for (const edge of edges) {
        tx.connectNodes(resolveId(edge.sourceId), resolveId(edge.targetId), edge.edgeType);
      }

      for (const [sourcePath, node] of existingBySourcePath) {
        if (!seenSourcePaths.has(sourcePath)) result.orphaned.push({ id: node.id, sourcePath });
      }

      return result;
    },
    { ...meta, operation: meta?.operation ?? "importProject" },
  );
}
