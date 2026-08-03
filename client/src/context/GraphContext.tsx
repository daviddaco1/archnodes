import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getProject, getSchema, type SchemaResponse } from "../api/client";
import type { AnyGraphNode, GraphEdge, ProjectManifest } from "../types/graph";
import { buildRuleMap, type ConnectionRules } from "../components/canvas/edgeValidation";
import { buildRefEdgeRules, type RefEdgeRules } from "../components/canvas/refEdges";

interface GraphContextValue {
  nodes: AnyGraphNode[];
  edges: GraphEdge[];
  manifest?: ProjectManifest;
  connectionRules: ConnectionRules;
  refEdgeRules: RefEdgeRules;
  schema?: SchemaResponse;
  loading: boolean;
  error: string | null;
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const [graph, schemaRes] = await Promise.all([getProject("all"), getSchema()]);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setManifest(graph.manifest);
      setSchema(schemaRes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const connectionRules = useMemo(() => buildRuleMap(schema?.connections ?? []), [schema]);
  const refEdgeRules = useMemo(() => buildRefEdgeRules(schema?.refFields), [schema]);

  const value: GraphContextValue = {
    nodes,
    edges,
    manifest,
    connectionRules,
    refEdgeRules,
    schema,
    loading,
    error,
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
