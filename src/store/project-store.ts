import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type {
  AnyGraphNode,
  BackendNodeType,
  EdgeType,
  FrontendNodeType,
  GraphEdge,
  NodeType,
  ProjectGraph,
  ProjectScope,
} from "../types/graph.js";
import { BACKEND_NODE_TYPES, FRONTEND_NODE_TYPES } from "../types/graph.js";
import {
  ValidationError,
  canConnectSpecial,
  clearDanglingRefs,
  validateProjectGraph,
  validateRefs,
  type ValidationIssue,
  type ValidationResult,
} from "../validation/rules.js";
import { checkProjectHealth, type ProjectHealth } from "../validation/health.js";
import { determineSyncStatus, type SyncStatus } from "../sync/conflict.js";
import {
  appendHistoryEntry,
  diffGraphs,
  filterHistory,
  readHistory,
  replayToPosition,
  writeHistoryFile,
  type HistoryEntry,
  type HistorySource,
} from "../history/history.js";
import {
  CASCADE_SNAPSHOT_THRESHOLD,
  createJsonFileAdapter,
  projectPath,
  type PersistenceAdapter,
} from "./persistence-adapter.js";
import { assertValidProjectName } from "../security/project-name.js";
import type { Role } from "../security/permissions.js";
import { appendAuditEntry, filterAuditLog, readAuditLog, type AuditEntry } from "../audit/audit-log.js";

const BACKEND_SET = new Set<NodeType>(BACKEND_NODE_TYPES);
const FRONTEND_SET = new Set<NodeType>(FRONTEND_NODE_TYPES);
// Visual-only structural types have no scope of their own — they belong in every scoped view.
const STRUCTURAL_SET = new Set<NodeType>(["container", "boundary", "note"]);

export interface ProjectStoreOptions {
  baseDir?: string;
  /** Defaults to the JSON file adapter — inject a different one (e.g. an in-memory fake for tests). */
  persistence?: PersistenceAdapter;
}

export interface DeleteResult {
  deletedIds: string[];
}

// Attached to a transaction's history entry (see history.ts) so `list_history`/audit trails can
// tell a UI edit from an agent-driven one. `operation` is filled in by the store itself (it names
// the actual method that ran); callers only ever supply source/author/description.
export interface TransactionMeta {
  source?: HistorySource;
  author?: string;
  role?: Role;
  description?: string;
  operation?: string;
}

export interface ProjectStore {
  getProject(scope?: ProjectScope): ProjectGraph;
  listNodes(type?: NodeType, filters?: Record<string, unknown>): AnyGraphNode[];
  getNode(id: string): AnyGraphNode | undefined;
  createNode(type: NodeType, props: unknown, parentId?: string, meta?: TransactionMeta): AnyGraphNode;
  updateNode(id: string, props: unknown, meta?: TransactionMeta): AnyGraphNode;
  setPosition(id: string, position: { x: number; y: number }, meta?: TransactionMeta): AnyGraphNode;
  setContainer(id: string, containerId: string | undefined, meta?: TransactionMeta): AnyGraphNode;
  updateManifest(patch: Partial<Omit<ProjectGraph["manifest"], "projectName" | "createdAt">>, meta?: TransactionMeta): void;
  deleteNode(id: string, cascade?: boolean, meta?: TransactionMeta): DeleteResult;
  connectNodes(sourceId: string, targetId: string, edgeType?: EdgeType, meta?: TransactionMeta): GraphEdge;
  deleteEdge(id: string, meta?: TransactionMeta): void;
  importGraph(nodes: AnyGraphNode[], edges: GraphEdge[], mode: "merge" | "replace", meta?: TransactionMeta): void;
  validateProject(): ValidationResult;
  /** Structural validation plus quality diagnostics (orphans, unused nodes, ref cycles) — never write-blocking. */
  checkHealth(): ProjectHealth;
  /**
   * Runs `fn` against this same store, but persists at most once — on success, after every
   * operation inside `fn` completes; on failure, not at all (the in-memory graph is rolled back
   * to how it looked before `fn` started, and the thrown error propagates to the caller).
   * Nested calls join the outermost transaction rather than committing early. A successful commit
   * that actually changed nodes/edges is recorded as one history entry.
   */
  transaction<T>(fn: (tx: ProjectStore) => T, meta?: TransactionMeta): T;
  applyBatch(ops: BatchOp[], meta?: TransactionMeta): unknown[];
  /** Reverts the most recent history entry. Throws if there is nothing to undo. */
  undo(): ProjectGraph;
  /** Re-applies the most recently undone history entry. Throws if there is nothing to redo. */
  redo(): ProjectGraph;
  listHistory(opts?: { limit?: number; before?: string }): HistoryEntry[];
  /** Moves the graph to the state right after the given history entry was originally applied. */
  restoreVersion(entryId: string): ProjectGraph;
  compareVersions(entryIdA: string, entryIdB: string): { nodesDiff: HistoryEntry["nodesDiff"]; edgesDiff: HistoryEntry["edgesDiff"] };
  /** Stamps a node with the source file hash an agent just synced against — never bumps updatedAt. */
  recordSync(id: string, patch: { sourceHash?: string; sourcePath?: string }, meta?: TransactionMeta): AnyGraphNode;
  getSyncStatus(id: string, currentHash?: string | null): SyncStatus;
  getBulkSyncStatus(hashes: Record<string, string | null>): Record<string, SyncStatus>;
  /** Append-only, never replayed — see src/audit/audit-log.ts for why this is separate from history. */
  recordAudit(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry;
  listAuditLog(opts?: { limit?: number; before?: string }): AuditEntry[];
}

// Whitelisted so a batch can only ever invoke one of the store's own known mutators — never an
// arbitrary/dynamic method name — keeping this the same trust boundary as calling them directly.
export type BatchMutatorMethod =
  | "createNode"
  | "updateNode"
  | "setPosition"
  | "setContainer"
  | "deleteNode"
  | "connectNodes"
  | "deleteEdge"
  | "importGraph"
  | "updateManifest";

export interface BatchOp {
  method: BatchMutatorMethod;
  args: unknown[];
}

const BATCH_MUTATOR_METHODS = new Set<BatchMutatorMethod>([
  "createNode",
  "updateNode",
  "setPosition",
  "setContainer",
  "deleteNode",
  "connectNodes",
  "deleteEdge",
  "importGraph",
  "updateManifest",
]);

function now(): string {
  return new Date().toISOString();
}

export function createProjectStore(projectName: string, opts: ProjectStoreOptions = {}): ProjectStore {
  // Single real entry point for REST, MCP, and the CLI's init/wizard/template paths alike — this
  // is the one guard against `--project ../../whatever` style path traversal.
  assertValidProjectName(projectName);
  const adapter = opts.persistence ?? createJsonFileAdapter(projectName, opts.baseDir);
  adapter.acquireLock();
  let graph = adapter.load();

  // History lives alongside the graph file regardless of which PersistenceAdapter backs the graph
  // itself — it's an audit log, not "the project's data", so it isn't part of that abstraction.
  const historyPath = join(dirname(projectPath(projectName, opts.baseDir)), ".history", "history.jsonl");
  // Separate file/folder from history — see audit-log.ts for why. Not read into memory eagerly
  // (unlike history, nothing here needs an in-memory replay cursor).
  const auditPath = join(dirname(projectPath(projectName, opts.baseDir)), ".audit", "audit.jsonl");
  let historyEntries = readHistory(historyPath);
  // How many entries are currently "applied" — undo() decrements, redo() increments. A fresh
  // commit while this is behind historyEntries.length drops the redo-able future (linear history,
  // no branching: the same model a text editor's undo stack uses).
  let historyPosition = historyEntries.length;

  // txDepth > 0 means we're inside store.transaction() — persist() is deferred to a single write
  // (or skipped entirely on rollback) instead of hitting disk once per mutation inside it.
  let txDepth = 0;
  let dirty = false;

  function persist(): void {
    if (txDepth > 0) {
      dirty = true;
      return;
    }
    graph.manifest.updatedAt = now();
    adapter.save(graph);
  }

  function findNode(id: string): AnyGraphNode | undefined {
    return graph.nodes.find((n) => n.id === id);
  }

  function requireNode(id: string): AnyGraphNode {
    const node = findNode(id);
    if (!node) throw new ValidationError([{ level: "error", code: "BROKEN_REF", nodeId: id, message: `Node ${id} not found` }]);
    return node;
  }

  function assertValidNode(candidate: AnyGraphNode, allNodes: AnyGraphNode[]): void {
    // Only refs (broken id / wrong target type) are hard-rejected at write time — a bad
    // reference actively corrupts data. Missing required fields are NOT rejected here: a visual
    // editor drops a bare node first and fills it in afterwards, so treat that as a diagnostic
    // (surfaced by validate_project(), same as import_graph's already-documented partial-data path)
    // rather than blocking node creation entirely.
    const issues = validateRefs(allNodes).filter((i) => i.nodeId === candidate.id);
    if (issues.length > 0) throw new ValidationError(issues);
  }

  // Same "actively corrupts data" bar as assertValidNode: a method outside the endpoint's
  // declared list, or a method that collides with a sibling operation, is rejected outright.
  function assertValidOperationMethod(candidate: AnyGraphNode, allNodes: AnyGraphNode[], parentIdOverride?: string): void {
    if (candidate.type !== "operation") return;
    const parentId = parentIdOverride ?? candidate.parentId;
    const method = (candidate.props as unknown as Record<string, unknown>).method as string | undefined;
    if (!parentId || !method) return;

    const issues: ValidationIssue[] = [];
    const endpoint = allNodes.find((n) => n.id === parentId);
    const allowedMethods =
      endpoint?.type === "endpoint"
        ? ((endpoint.props as unknown as Record<string, unknown>).methods as string[] | undefined)
        : undefined;
    if (allowedMethods && !allowedMethods.includes(method)) {
      issues.push({
        level: "error",
        code: "INVALID_OPERATION_METHOD",
        nodeId: candidate.id,
        field: "method",
        message: `Method "${method}" is not declared in the parent endpoint's methods [${allowedMethods.join(", ")}]`,
      });
    }
    const collides = allNodes.some(
      (n) =>
        n.type === "operation" &&
        n.id !== candidate.id &&
        n.parentId === parentId &&
        (n.props as unknown as Record<string, unknown>).method === method,
    );
    if (collides) {
      issues.push({
        level: "error",
        code: "DUPLICATE_OPERATION_METHOD",
        nodeId: candidate.id,
        field: "method",
        message: `Another operation under the same endpoint already uses method "${method}"`,
      });
    }
    if (issues.length > 0) throw new ValidationError(issues);
  }

  // Walks from `startId` via `next()` looking for `targetId`, stopping (false) if it runs off the
  // graph or loops back on itself first — the visited-set makes this safe even if the data already
  // contains a cycle from before this check existed.
  function walksTo(startId: string, targetId: string, next: (n: AnyGraphNode) => string | undefined): boolean {
    const visited = new Set<string>();
    let currentId: string | undefined = startId;
    while (currentId) {
      if (currentId === targetId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);
      const node = findNode(currentId);
      if (!node) return false;
      currentId = next(node);
    }
    return false;
  }

  function assertNoHierarchyCycle(parentId: string, childId: string): void {
    // childId becoming an ancestor of its own would-be parent (or parentId===childId) forms a loop.
    if (walksTo(parentId, childId, (n) => n.parentId)) {
      throw new ValidationError([
        {
          level: "error",
          code: "CYCLE_DETECTED",
          nodeId: childId,
          message: `Cannot set ${childId} as a child of ${parentId}: would create a hierarchy cycle`,
        },
      ]);
    }
  }

  function linkHierarchy(parentId: string, childId: string): GraphEdge {
    const parent = requireNode(parentId);
    const child = requireNode(childId);
    if (!canConnectSpecial("hierarchy", parent.type, child.type)) {
      throw new ValidationError([
        {
          level: "error",
          code: "INVALID_HIERARCHY",
          nodeId: childId,
          message: `Invalid hierarchy: ${parent.type} cannot be parent of ${child.type}`,
        },
      ]);
    }
    assertNoHierarchyCycle(parentId, childId);
    const edge: GraphEdge = { id: randomUUID(), source: parentId, target: childId, edgeType: "hierarchy" };
    graph.edges.push(edge);
    child.parentId = parentId;
    child.updatedAt = now();
    return edge;
  }

  const store: ProjectStore = {
    getProject(scope: ProjectScope = "all") {
      if (scope === "all") return graph;
      const set = scope === "backend" ? BACKEND_SET : FRONTEND_SET;
      const nodes = graph.nodes.filter((n) => set.has(n.type) || STRUCTURAL_SET.has(n.type));
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
      return { manifest: graph.manifest, nodes, edges };
    },

    listNodes(type?: NodeType, filters?: Record<string, unknown>) {
      let nodes = graph.nodes;
      if (type) nodes = nodes.filter((n) => n.type === type);
      if (filters) {
        nodes = nodes.filter((n) =>
          Object.entries(filters).every(([key, value]) => (n.props as Record<string, unknown>)[key] === value),
        );
      }
      return nodes;
    },

    getNode(id: string) {
      return findNode(id);
    },

    createNode(type: NodeType, props: unknown, parentId?: string, meta?: TransactionMeta) {
      return store.transaction(() => {
        const timestamp = now();
        const node = {
          id: randomUUID(),
          type,
          label: (props as Record<string, unknown>)?.name ?? (props as Record<string, unknown>)?.label ?? type,
          position: { x: 0, y: 0 },
          props: props ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        } as AnyGraphNode;

        assertValidNode(node, [...graph.nodes, node]);
        if (parentId) assertValidOperationMethod(node, [...graph.nodes, node], parentId);
        graph.nodes.push(node);
        if (parentId) {
          try {
            linkHierarchy(parentId, node.id);
          } catch (err) {
            graph.nodes.pop();
            throw err;
          }
        }
        persist();
        return node;
      }, { ...meta, operation: "createNode" });
    },

    updateManifest(patch, meta?: TransactionMeta) {
      store.transaction(() => {
        Object.assign(graph.manifest, patch);
        persist();
      }, { ...meta, operation: "updateManifest" });
    },

    updateNode(id: string, props: unknown, meta?: TransactionMeta) {
      return store.transaction(() => {
        const node = requireNode(id);
        const merged = { ...(node.props as Record<string, unknown>), ...(props as Record<string, unknown>) };
        const candidate = { ...node, props: merged } as AnyGraphNode;
        const allNodes = graph.nodes.map((n) => (n.id === id ? candidate : n));
        assertValidNode(candidate, allNodes);
        assertValidOperationMethod(candidate, allNodes);
        if (candidate.type === "endpoint") {
          // Editing methods must not silently orphan an existing operation child's method.
          const children = graph.edges
            .filter((e) => e.edgeType === "hierarchy" && e.source === id)
            .map((e) => allNodes.find((n) => n.id === e.target))
            .filter((n): n is AnyGraphNode => Boolean(n && n.type === "operation"));
          for (const child of children) assertValidOperationMethod(child, allNodes);
        }
        node.props = merged as never;
        node.updatedAt = now();
        if (typeof merged.name === "string") node.label = merged.name;
        persist();
        return node;
      }, { ...meta, operation: "updateNode" });
    },

    setPosition(id: string, position: { x: number; y: number }, meta?: TransactionMeta) {
      return store.transaction(() => {
        const node = requireNode(id);
        node.position = position;
        node.updatedAt = now();
        persist();
        return node;
      }, { ...meta, operation: "setPosition" });
    },

    setContainer(id: string, containerId: string | undefined, meta?: TransactionMeta) {
      // Visual-only grouping (React Flow subflow), not a hierarchy edge — no connection-rule check,
      // but it still must resolve to a real node and can't nest a container inside itself.
      return store.transaction(() => {
        const node = requireNode(id);
        if (containerId !== undefined) {
          requireNode(containerId);
          if (walksTo(containerId, id, (n) => n.containerId)) {
            throw new ValidationError([
              {
                level: "error",
                code: "CYCLE_DETECTED",
                nodeId: id,
                message: `Cannot set ${id}'s container to ${containerId}: would create a container cycle`,
              },
            ]);
          }
        }
        node.containerId = containerId;
        node.updatedAt = now();
        persist();
        return node;
      }, { ...meta, operation: "setContainer" });
    },

    deleteNode(id: string, cascade = false, meta?: TransactionMeta) {
      return store.transaction(() => {
        requireNode(id);
        const childrenEdges = graph.edges.filter((e) => e.edgeType === "hierarchy" && e.source === id);
        if (childrenEdges.length > 0 && !cascade) {
          throw new ValidationError([
            { level: "error", code: "INVALID_HIERARCHY", nodeId: id, message: `Node ${id} has children; pass cascade:true to delete them too` },
          ]);
        }

        const toDelete = new Set<string>([id]);
        if (cascade) {
          const stack = [id];
          while (stack.length > 0) {
            const current = stack.pop()!;
            for (const edge of graph.edges) {
              if (edge.edgeType === "hierarchy" && edge.source === current && !toDelete.has(edge.target)) {
                toDelete.add(edge.target);
                stack.push(edge.target);
              }
            }
          }
        }

        if (toDelete.size > CASCADE_SNAPSHOT_THRESHOLD) adapter.snapshot();

        graph.nodes = graph.nodes.filter((n) => !toDelete.has(n.id));
        graph.edges = graph.edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target));
        clearDanglingRefs(graph.nodes, toDelete);
        // containerId is visual-only grouping, not a REF_FIELDS ref — clearDanglingRefs doesn't touch it.
        for (const n of graph.nodes) {
          if (n.containerId && toDelete.has(n.containerId)) n.containerId = undefined;
        }
        persist();
        return { deletedIds: [...toDelete] };
      }, { ...meta, operation: "deleteNode" });
    },

    connectNodes(sourceId: string, targetId: string, edgeType: EdgeType = "hierarchy", meta?: TransactionMeta) {
      return store.transaction(() => {
        const source = requireNode(sourceId);
        const target = requireNode(targetId);
        if (!canConnectSpecial(edgeType, source.type, target.type)) {
          throw new ValidationError([
            {
              level: "error",
              code: edgeType === "hierarchy" ? "INVALID_HIERARCHY" : "INVALID_EDGE",
              nodeId: targetId,
              message: `Invalid ${edgeType} edge: ${source.type} -> ${target.type}`,
            },
          ]);
        }
        const existing = graph.edges.find(
          (e) => e.source === sourceId && e.target === targetId && e.edgeType === edgeType,
        );
        if (existing) return existing;
        if (edgeType === "hierarchy") {
          assertNoHierarchyCycle(sourceId, targetId);
          if (target.type === "operation") assertValidOperationMethod(target, graph.nodes, sourceId);
          // A child has at most one live hierarchy parent — reparenting replaces the old edge.
          graph.edges = graph.edges.filter((e) => !(e.edgeType === "hierarchy" && e.target === targetId));
        }
        const edge: GraphEdge = { id: randomUUID(), source: sourceId, target: targetId, edgeType };
        graph.edges.push(edge);
        if (edgeType === "hierarchy") {
          target.parentId = sourceId;
          target.updatedAt = now();
        }
        persist();
        return edge;
      }, { ...meta, operation: "connectNodes" });
    },

    deleteEdge(id: string, meta?: TransactionMeta) {
      store.transaction(() => {
        const edge = graph.edges.find((e) => e.id === id);
        if (!edge) return;
        graph.edges = graph.edges.filter((e) => e.id !== id);
        if (edge.edgeType === "hierarchy") {
          const target = findNode(edge.target);
          if (target && target.parentId === edge.source) {
            target.parentId = undefined;
            target.updatedAt = now();
          }
        }
        persist();
      }, { ...meta, operation: "deleteEdge" });
    },

    importGraph(nodes: AnyGraphNode[], edges: GraphEdge[], mode: "merge" | "replace", meta?: TransactionMeta) {
      store.transaction(() => {
        if (mode === "replace") {
          adapter.snapshot();
          graph.nodes = nodes;
          graph.edges = edges;
        } else {
          const nodeIds = new Map(graph.nodes.map((n) => [n.id, n]));
          for (const node of nodes) nodeIds.set(node.id, node);
          graph.nodes = [...nodeIds.values()];

          const edgeIds = new Map(graph.edges.map((e) => [e.id, e]));
          for (const edge of edges) edgeIds.set(edge.id, edge);
          graph.edges = [...edgeIds.values()];
        }
        persist();
      }, { ...meta, operation: "importGraph" });
    },

    validateProject() {
      return validateProjectGraph(graph);
    },

    checkHealth() {
      return checkProjectHealth(graph);
    },

    recordSync(id: string, patch: { sourceHash?: string; sourcePath?: string }, meta?: TransactionMeta) {
      return store.transaction(() => {
        const node = requireNode(id);
        if (patch.sourceHash !== undefined) node.sourceHash = patch.sourceHash;
        if (patch.sourcePath !== undefined) node.sourcePath = patch.sourcePath;
        node.lastSyncedAt = now();
        // Deliberately NOT touching node.updatedAt: this stamps sync metadata, not a content edit —
        // determineSyncStatus()'s graphChanged check relies on updatedAt reflecting real edits only.
        persist();
        return node;
      }, { ...meta, operation: "recordSync" });
    },

    getSyncStatus(id: string, currentHash?: string | null) {
      return determineSyncStatus(requireNode(id), currentHash);
    },

    getBulkSyncStatus(hashes: Record<string, string | null>) {
      const result: Record<string, SyncStatus> = {};
      for (const node of graph.nodes) {
        result[node.id] = determineSyncStatus(node, hashes[node.id]);
      }
      return result;
    },

    recordAudit(entry: Omit<AuditEntry, "id" | "timestamp">) {
      const full: AuditEntry = { id: randomUUID(), timestamp: now(), ...entry };
      appendAuditEntry(auditPath, full);
      return full;
    },

    listAuditLog(opts?: { limit?: number; before?: string }) {
      return filterAuditLog(readAuditLog(auditPath), opts);
    },

    transaction<T>(fn: (tx: ProjectStore) => T, meta?: TransactionMeta): T {
      if (txDepth > 0) return fn(store); // nested: outermost transaction owns commit/rollback/history
      const snapshot = structuredClone(graph);
      txDepth = 1;
      dirty = false;
      try {
        const result = fn(store);
        txDepth = 0;
        if (dirty) {
          recordHistoryEntry(snapshot, meta);
          persist(); // one real write for the whole transaction, not one per mutation
        }
        return result;
      } catch (err) {
        graph = snapshot; // rollback in memory — disk was never touched
        txDepth = 0;
        dirty = false;
        throw err;
      }
    },

    applyBatch(ops: BatchOp[], meta?: TransactionMeta) {
      for (const op of ops) {
        if (!BATCH_MUTATOR_METHODS.has(op.method)) {
          throw new ValidationError([
            {
              level: "error",
              code: "INVALID_BATCH_OPERATION",
              message: `Unknown batch operation "${op.method}"`,
            },
          ]);
        }
      }
      return store.transaction(
        (tx) => ops.map((op) => (tx[op.method] as (...a: unknown[]) => unknown)(...op.args)),
        { ...meta, operation: meta?.operation ?? "applyBatch" },
      );
    },

    undo() {
      if (historyPosition === 0) throw new Error("Nothing to undo");
      replayToPosition(graph, historyEntries, historyPosition, historyPosition - 1);
      historyPosition -= 1;
      persist();
      return graph;
    },

    redo() {
      if (historyPosition === historyEntries.length) throw new Error("Nothing to redo");
      replayToPosition(graph, historyEntries, historyPosition, historyPosition + 1);
      historyPosition += 1;
      persist();
      return graph;
    },

    listHistory(opts?: { limit?: number; before?: string }) {
      return filterHistory(historyEntries, opts);
    },

    restoreVersion(entryId: string) {
      const idx = historyEntries.findIndex((e) => e.id === entryId);
      if (idx < 0) throw new Error(`History entry ${entryId} not found`);
      const target = idx + 1;
      replayToPosition(graph, historyEntries, historyPosition, target);
      historyPosition = target;
      persist();
      return graph;
    },

    compareVersions(entryIdA: string, entryIdB: string) {
      const idxA = historyEntries.findIndex((e) => e.id === entryIdA);
      const idxB = historyEntries.findIndex((e) => e.id === entryIdB);
      if (idxA < 0) throw new Error(`History entry ${entryIdA} not found`);
      if (idxB < 0) throw new Error(`History entry ${entryIdB} not found`);
      const graphA = structuredClone(graph);
      replayToPosition(graphA, historyEntries, historyPosition, idxA + 1);
      const graphB = structuredClone(graph);
      replayToPosition(graphB, historyEntries, historyPosition, idxB + 1);
      return diffGraphs(graphA, graphB);
    },
  };

  // Called only from the outermost transaction() commit, with `before` = the graph snapshot taken
  // when that transaction started — so a batch of N mutations still yields exactly one entry.
  function recordHistoryEntry(before: ProjectGraph, meta?: TransactionMeta): void {
    const { nodesDiff, edgesDiff } = diffGraphs(before, graph);
    if (nodesDiff.length === 0 && edgesDiff.length === 0) return; // e.g. updateManifest alone
    const entry: HistoryEntry = {
      id: randomUUID(),
      timestamp: now(),
      operation: meta?.operation ?? "transaction",
      source: meta?.source ?? "system",
      author: meta?.author,
      role: meta?.role,
      description: meta?.description,
      nodesDiff,
      edgesDiff,
    };
    if (historyPosition < historyEntries.length) {
      // A fresh edit landed after one or more undo()s — the redo-able future is no longer valid.
      historyEntries = [...historyEntries.slice(0, historyPosition), entry];
      writeHistoryFile(historyPath, historyEntries);
    } else {
      historyEntries.push(entry);
      appendHistoryEntry(historyPath, entry);
    }
    historyPosition = historyEntries.length;
  }

  return store;
}

export type { BackendNodeType, FrontendNodeType };
