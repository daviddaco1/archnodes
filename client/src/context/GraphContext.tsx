import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getProject, getSchema, type SchemaResponse } from "../api/client";
import type { AnyGraphNode, GraphEdge, ProjectManifest } from "../types/graph";
import { buildRuleMap, type ConnectionRules } from "../components/canvas/edgeValidation";
import {
  buildArrayRefPorts,
  buildChainTargetTypes,
  buildRefPortRules,
  type ArrayRefSpec,
  type RefPortRules,
} from "../components/canvas/refEdges";
import type { NodeType } from "../types/graph";

interface GraphContextValue {
  nodes: AnyGraphNode[];
  edges: GraphEdge[];
  manifest?: ProjectManifest;
  connectionRules: ConnectionRules;
  refPortRules: RefPortRules;
  arrayRefPorts: Map<NodeType, ArrayRefSpec[]>;
  chainTargetTypes: Set<NodeType>;
  schema?: SchemaResponse;
  loading: boolean;
  error: string | null;
  notice: string | null;
  notify: (message: string) => void;
  dismissNotice: () => void;
  refetch: () => Promise<void>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  focusField: string | null;
  setFocusField: (field: string | null) => void;
}

const GraphContext = createContext<GraphContextValue | undefined>(undefined);

export function GraphProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<AnyGraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [manifest, setManifest] = useState<ProjectManifest | undefined>(undefined);
  const [schema, setSchema] = useState<SchemaResponse | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);
  const refetchSeq = useRef(0);

  const notify = useCallback((message: string) => setNotice(message), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const refetch = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const [graph, schemaRes] = await Promise.all([getProject("all"), getSchema()]);
      if (seq !== refetchSeq.current) return; // a newer refetch already resolved, discard this one
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setManifest(graph.manifest);
      setSchema(schemaRes);
      setError(null);
      hasLoadedOnce.current = true;
    } catch (err) {
      if (seq !== refetchSeq.current) return;
      const message = err instanceof Error ? err.message : String(err);
      // Only the initial load blocks the whole app; a refetch after a mutation surfaces as a
      // dismissible notice instead of tearing down the canvas the user is still looking at.
      if (hasLoadedOnce.current) setNotice(message);
      else setError(message);
    } finally {
      if (seq === refetchSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const connectionRules = useMemo(() => buildRuleMap(schema?.connections ?? []), [schema]);
  const refPortRules = useMemo(() => buildRefPortRules(schema?.refFields), [schema]);
  const arrayRefPorts = useMemo(() => buildArrayRefPorts(schema?.refFields), [schema]);
  const chainTargetTypes = useMemo(() => buildChainTargetTypes(schema?.refFields), [schema]);

  const value: GraphContextValue = {
    nodes,
    edges,
    manifest,
    connectionRules,
    refPortRules,
    arrayRefPorts,
    chainTargetTypes,
    schema,
    loading,
    error,
    notice,
    notify,
    dismissNotice,
    refetch,
    selectedNodeId,
    setSelectedNodeId,
    focusField,
    setFocusField,
  };

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

export function useGraph(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error("useGraph must be used within a GraphProvider");
  return ctx;
}
