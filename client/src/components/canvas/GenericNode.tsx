import { useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { nodeSchemas } from "../../schema/nodeSchemas";
import type { NodeType } from "../../types/graph";
import styles from "./GenericNode.module.css";

export interface GenericNodeData {
  nodeType: NodeType;
  props: Record<string, unknown>;
  resolvedTitle?: string;
  highlight?: "valid" | "invalid";
  compatibleTypes?: NodeType[];
  incomingCompatibleTypes?: NodeType[];
  canReceiveConnection?: boolean;
  onQuickAdd?: (targetType: NodeType) => void;
  onQuickAddIncoming?: (sourceType: NodeType) => void;
  [key: string]: unknown;
}

function pickTitle(schema: (typeof nodeSchemas)[NodeType], props: Record<string, unknown>): string {
  if (typeof props.name === "string" && props.name) return props.name;
  if (typeof props.label === "string" && props.label) return props.label;
  for (const field of schema.fields) {
    if (field.kind !== "text" && field.kind !== "textarea") continue;
    const value = props[field.key];
    if (typeof value === "string" && value) return value;
  }
  return schema.type;
}

function formatSummaryValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return String(obj.name ?? obj.event ?? obj.status ?? "?");
        }
        return String(item);
      })
      .join(", ");
  }
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

interface QuickAddProps {
  types: NodeType[];
  edge: "top" | "bottom";
  title: string;
  onSelect: (type: NodeType) => void;
}

function QuickAdd({ types, edge, title, onSelect }: QuickAddProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick, { capture: true });
    return () => document.removeEventListener("mousedown", closeOnOutsideClick, { capture: true });
  }, [open]);

  if (types.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`nodrag nopan ${edge === "top" ? styles.quickAddBtnTop : styles.quickAddBtn}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={title}
      >
        +
      </button>
      {open && (
        <div ref={menuRef} className={`nodrag nopan ${edge === "top" ? styles.quickAddMenuTop : styles.quickAddMenu}`}>
          {types.map((type) => {
            const targetSchema = nodeSchemas[type];
            return (
              <button
                key={type}
                type="button"
                className={styles.quickAddItem}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onSelect(type);
                }}
              >
                <span className={styles.quickAddSwatch} style={{ background: targetSchema.color }} />
                <span className="mono">{type}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function GenericNode({ data, selected }: NodeProps & { data: GenericNodeData }) {
  const schema = nodeSchemas[data.nodeType];
  const title = data.resolvedTitle ?? pickTitle(schema, data.props);
  const summaryLines = schema.summaryFields
    .map((field) => {
      const text = formatSummaryValue(data.props[field]);
      if (!text || text === title) return null;
      const label = schema.fields.find((f) => f.key === field)?.label;
      return { key: field, text: label ? `${label}: ${text}` : text };
    })
    .filter((line): line is { key: string; text: string } => Boolean(line));

  const compatibleTypes = data.compatibleTypes ?? [];
  const incomingCompatibleTypes = data.incomingCompatibleTypes ?? [];
  const canReceiveConnection = data.canReceiveConnection ?? false;

  const highlightClass = data.highlight === "valid" ? styles.valid : data.highlight === "invalid" ? styles.invalid : "";

  return (
    <div className={styles.wrapper}>
      {canReceiveConnection && <Handle type="target" position={Position.Top} />}
      <div className={`${styles.node} ${selected ? styles.selected : ""} ${highlightClass}`}>
        <div className={styles.header} style={{ background: schema.color }}>
          <span className={styles.icon}>{schema.icon}</span>
          <span className={styles.type}>{schema.type}</span>
        </div>
        <div className={styles.body}>
          <div>{title}</div>
          {summaryLines.map((line) => (
            <div key={line.key} className={styles.summary}>
              {line.text}
            </div>
          ))}
        </div>
      </div>
      {compatibleTypes.length > 0 && <Handle type="source" position={Position.Bottom} />}

      {canReceiveConnection && (
        <QuickAdd
          types={incomingCompatibleTypes}
          edge="top"
          title="Agregar nodo que se conecte a este"
          onSelect={(type) => data.onQuickAddIncoming?.(type)}
        />
      )}
      <QuickAdd types={compatibleTypes} edge="bottom" title="Agregar nodo conectado" onSelect={(type) => data.onQuickAdd?.(type)} />
    </div>
  );
}
