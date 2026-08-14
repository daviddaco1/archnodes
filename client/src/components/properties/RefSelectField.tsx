import { useGraph } from "../../context/GraphContext";
import { nodeSchemas } from "../../schema/nodeSchemas";
import { formatSummaryValue } from "../canvas/GenericNode";
import type { AnyGraphNode } from "@project-visualizer/shared/graph.js";
import type { FieldDef } from "../../schema/fieldTypes";

interface RefSelectFieldProps {
  field: FieldDef;
  value: string | undefined;
  onChange: (value: string) => void;
}

function optionLabel(node: AnyGraphNode): string {
  const schema = nodeSchemas[node.type];
  const props = node.props as Record<string, unknown>;
  const name = (props.name as string) || (props.label as string) || "";
  const summary = schema.summaryFields
    .map((f) => formatSummaryValue(props[f]))
    .filter(Boolean)
    .join(" ");
  if (name && summary) return `${name} (${summary})`;
  return name || summary || schema.type;
}

export function RefSelectField({ field, value, onChange }: RefSelectFieldProps) {
  const { nodes } = useGraph();
  const allowedTypes = Array.isArray(field.refNodeType) ? field.refNodeType : field.refNodeType ? [field.refNodeType] : [];
  const options = nodes.filter((n) => allowedTypes.includes(n.type));

  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((n) => (
        <option key={n.id} value={n.id}>
          {optionLabel(n)}
        </option>
      ))}
    </select>
  );
}
