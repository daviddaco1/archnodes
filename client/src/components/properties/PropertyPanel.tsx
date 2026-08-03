import { useState } from "react";
import { useGraph } from "../../context/GraphContext";
import { nodeSchemas } from "../../schema/nodeSchemas";
import { defaultCompanionProps } from "../../schema/companionDefaults";
import { edgeKind } from "../canvas/edgeValidation";
import * as api from "../../api/client";
import type { NodeType } from "../../types/graph";
import { PropertyForm } from "./PropertyForm";
import styles from "./PropertyPanel.module.css";

export function PropertyPanel() {
  const { nodes, edges, connectionRules, selectedNodeId, setSelectedNodeId, refetch } = useGraph();
  const [cascade, setCascade] = useState(false);
  const node = nodes.find((n) => n.id === selectedNodeId);

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
        <strong>{schema.type}</strong>
        <button onClick={() => setSelectedNodeId(null)}>×</button>
      </div>

      <PropertyForm node={node} onSaved={refetch} />

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

      <div style={{ marginTop: 16, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} /> Eliminar también sus hijos
        </label>
        <button className={styles.danger} onClick={() => void handleDelete()}>
          Eliminar nodo
        </button>
      </div>
    </div>
  );
}
