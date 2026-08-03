import { useMemo, useState } from "react";
import { useGraph } from "../../context/GraphContext";
import { nodeSchemas } from "../../schema/nodeSchemas";
import { defaultCompanionProps } from "../../schema/companionDefaults";
import { edgeKind } from "../canvas/edgeValidation";
import * as api from "../../api/client";
import type { AnyGraphNode, GraphEdge, MiddlewareProps, NodeType, ServiceProps, SubdomainProps } from "../../types/graph";
import { PropertyForm } from "./PropertyForm";
import styles from "./PropertyPanel.module.css";

function resolveEndpointChain(
  endpointId: string,
  nodes: AnyGraphNode[],
  edges: GraphEdge[],
): { middlewares: AnyGraphNode[]; service?: AnyGraphNode } {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = (id: string) =>
    edges.filter((e) => e.edgeType === "hierarchy" && e.source === id).map((e) => nodesById.get(e.target)).filter((n): n is AnyGraphNode => Boolean(n));

  const middlewares: AnyGraphNode[] = [];
  let service: AnyGraphNode | undefined;
  let currentId = endpointId;
  for (let i = 0; i < nodes.length; i++) {
    const children = childrenOf(currentId);
    const mw = children.find((c) => c.type === "middleware");
    const svc = children.find((c) => c.type === "service");
    if (mw) {
      middlewares.push(mw);
      currentId = mw.id;
      continue;
    }
    if (svc) service = svc;
    break;
  }
  return { middlewares, service };
}

export function PropertyPanel() {
  const { nodes, edges, connectionRules, selectedNodeId, setSelectedNodeId, refetch } = useGraph();
  const [cascade, setCascade] = useState(false);
  const node = nodes.find((n) => n.id === selectedNodeId);

  const inheritedReturns = useMemo(() => {
    if (!node || node.type !== "endpoint") return [];
    const { middlewares, service } = resolveEndpointChain(node.id, nodes, edges);
    const rows: { status: string | number; description?: string; source: string }[] = [];
    for (const mw of middlewares) {
      const mwProps = mw.props as MiddlewareProps;
      for (const r of mwProps.returns ?? []) rows.push({ status: r.status, description: r.description, source: `middleware:${mwProps.name}` });
    }
    if (service) {
      const svcProps = service.props as ServiceProps;
      for (const r of svcProps.errors ?? []) rows.push({ status: r.status, description: r.description, source: `service:${svcProps.name}` });
    }
    return rows;
  }, [node, nodes, edges]);

  const subdomainPreview = useMemo(() => {
    if (!node || node.type !== "subdomain") return null;
    const props = node.props as SubdomainProps;
    if (!props.subdomain) return null;
    const domainNode = nodes.find((n) => n.id === props.domainId);
    const domainValue = domainNode && (domainNode.props as { domain?: string }).domain;
    if (!domainValue) return null;
    return `${props.subdomain}.${domainValue}`;
  }, [node, nodes]);

  if (!node) {
    return (
      <div className={styles.panel}>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Seleccioná un nodo para ver sus propiedades.</p>
      </div>
    );
  }

  const schema = nodeSchemas[node.type];

  const isSatisfied = (companionType: NodeType): boolean => {
    const kind = edgeKind(connectionRules, node.type, companionType);
    if (kind) {
      return edges.some((e) => e.edgeType === kind && e.source === node.id && nodes.find((n) => n.id === e.target)?.type === companionType);
    }
    const refField = schema.fields.find((f) => {
      const types = Array.isArray(f.refNodeType) ? f.refNodeType : f.refNodeType ? [f.refNodeType] : [];
      return types.includes(companionType);
    });
    if (refField) return Boolean((node.props as Record<string, unknown>)[refField.key]);
    return true; // no known relation to check — don't nag about it
  };

  const missingCompanions = (schema.suggestedCompanions ?? []).filter((c) => !isSatisfied(c.type));

  const applySuggestion = async (companionType: NodeType) => {
    const created = await api.createNode(companionType, defaultCompanionProps(companionType, nodes));
    const kind = edgeKind(connectionRules, node.type, companionType);
    if (kind) {
      await api.createEdge(node.id, created.id, kind);
    } else {
      const refField = schema.fields.find((f) => {
        const types = Array.isArray(f.refNodeType) ? f.refNodeType : f.refNodeType ? [f.refNodeType] : [];
        return types.includes(companionType);
      });
      if (refField) await api.updateNode(node.id, { [refField.key]: created.id });
    }
    await refetch();
  };

  const handleDelete = async () => {
    await api.deleteNode(node.id, cascade);
    setSelectedNodeId(null);
    await refetch();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{schema.type}</span>
        <button className="btn-icon" onClick={() => setSelectedNodeId(null)}>
          ×
        </button>
      </div>

      <PropertyForm node={node} onSaved={refetch} />

      {subdomainPreview && (
        <div className={styles.preview}>
          Se vería como <span className="mono">{subdomainPreview}</span>
        </div>
      )}

      {inheritedReturns.length > 0 && (
        <div className={styles.preview}>
          <div style={{ marginBottom: 6, fontWeight: 500 }}>Outputs heredados (middleware / service)</div>
          {inheritedReturns.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span className="mono">{r.status}</span>
              <span style={{ color: "var(--color-text-muted)", flex: 1 }}>{r.description}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--color-text-faint)" }}>
                {r.source}
              </span>
            </div>
          ))}
        </div>
      )}

      {missingCompanions.length > 0 && (
        <div className={styles.suggestions}>
          💡 Sugerido:
          {missingCompanions.map((c) => (
            <span key={c.type} className={styles.suggestionChip} title={c.reason}>
              {c.type}
              <button onClick={() => void applySuggestion(c.type)}>+</button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <label style={{ display: "block", marginBottom: 8 }}>
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} /> Eliminar también sus hijos
        </label>
        <button className="btn-danger" onClick={() => void handleDelete()}>
          Eliminar nodo
        </button>
      </div>
    </div>
  );
}
