import { useMemo, useState } from "react";
import { useGraph } from "../../context/GraphContext";
import { nodeSchemas } from "../../schema/nodeSchemas";
import styles from "./OverviewTab.module.css";

interface CrossRefRow {
  frontendNodeId: string;
  frontendLabel: string;
  frontendType: string;
  fieldLabel: string;
  backendLabel: string;
  backendId: string;
}

export function OverviewTab() {
  const { nodes } = useGraph();
  const [filter, setFilter] = useState("");

  const rows = useMemo<CrossRefRow[]>(() => {
    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const result: CrossRefRow[] = [];
    for (const node of nodes) {
      const schema = nodeSchemas[node.type];
      if (schema.category !== "frontend") continue;
      for (const field of schema.fields) {
        if (field.kind !== "refSelectCrossTab") continue;
        const refId = (node.props as Record<string, unknown>)[field.key] as string | undefined;
        if (!refId) continue;
        const backendNode = nodesById.get(refId);
        const backendSchema = backendNode ? nodeSchemas[backendNode.type] : undefined;
        const backendLabel = backendNode
          ? backendSchema!.summaryFields.map((f) => (backendNode.props as Record<string, unknown>)[f]).filter(Boolean).join(" ") ||
            (backendNode.props as Record<string, unknown>).name as string
          : `(roto: ${refId})`;
        result.push({
          frontendNodeId: node.id,
          frontendLabel: ((node.props as Record<string, unknown>).name as string) ?? node.label,
          frontendType: node.type,
          fieldLabel: field.label,
          backendLabel,
          backendId: refId,
        });
      }
    }
    return result;
  }, [nodes]);

  const filtered = rows.filter((r) => `${r.frontendLabel} ${r.backendLabel}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.heading}>Referencias cruzadas Frontend → Backend</h3>
      <input className={styles.filter} placeholder="Filtrar..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table>
        <thead>
          <tr>
            <th>Nodo Frontend</th>
            <th>Tipo</th>
            <th>Campo</th>
            <th></th>
            <th>Nodo Backend</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, i) => (
            <tr key={i}>
              <td>{row.frontendLabel}</td>
              <td>{row.frontendType}</td>
              <td>{row.fieldLabel}</td>
              <td>→</td>
              <td>{row.backendLabel}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--color-text-muted)" }}>
                Sin referencias cruzadas todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
