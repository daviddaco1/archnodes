import { Handle, Position, type NodeProps } from "@xyflow/react";
import { nodeSchemas } from "../../schema/nodeSchemas";
import type { NodeType } from "../../types/graph";
import styles from "./GenericNode.module.css";

export interface GenericNodeData {
  nodeType: NodeType;
  props: Record<string, unknown>;
  [key: string]: unknown;
}

export function GenericNode({ data, selected }: NodeProps & { data: GenericNodeData }) {
  const schema = nodeSchemas[data.nodeType];
  const title = (data.props.name as string) ?? (data.props.label as string) ?? schema.type;
  const summary = schema.summaryFields
    .map((field) => data.props[field])
    .filter((v) => v !== undefined && v !== "" && v !== title)
    .join(" · ");

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className={styles.header} style={{ background: schema.color }}>
        <span className={styles.icon}>{schema.icon}</span>
        <span className={styles.type}>{schema.type}</span>
      </div>
      <div className={styles.body}>
        <div>{title}</div>
        {summary && <div className={styles.summary}>{summary}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
